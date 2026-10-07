import type {
  PinnedObject,
  ShardProgress,
} from '../../wasm/sia_storage_wasm.js'
import { streamErrorMessage } from './errors'
import {
  type ClientReply,
  isSourceReply,
  type PageMessage,
  parseStreamPath,
  requestReply,
  type Connection,
  type SourceDetails,
  type StreamEvent,
  type StreamStatus,
  type WorkerMessage,
} from './protocol'
import {
  type ByteRange,
  errorResponse,
  parseRange,
  responseHeaders,
} from './response'

const SOURCE_TIMEOUT = 5_000
const IDLE_TIMEOUT = 5 * 60_000
// How long bytes and shard reports for one URL collect before they are sent,
// so a stream costs a few messages a second rather than one per chunk.
const REPORT_INTERVAL = 100

/** An object as the page describes it. See `SourceDetails`. */
export type ObjectRef = Pick<SourceDetails, 'objectId' | 'sealed'>

/** A connected SDK of either kind, as the worker uses it. */
export type StreamSdk = {
  object(ref: ObjectRef): Promise<PinnedObject>
  download(
    object: PinnedObject,
    options: {
      offset: number
      length: number
      onShardDownloaded?: (progress: ShardProgress) => void
    },
  ): ReadableStream
  free(): void
}

// The parts of ServiceWorkerGlobalScope this module uses, written out so it
// type-checks alongside page code, whose DOM types conflict with the service
// worker ones. A real ServiceWorkerGlobalScope satisfies them.
type StreamClient = { id: string; postMessage(message: unknown, transfer?: Transferable[]): void }
type WaitUntil = { waitUntil(promise: Promise<unknown>): void }
type StreamFetchEvent = { request: Request; respondWith(response: Promise<Response>): void }
type StreamMessageEvent = WaitUntil & {
  data: unknown
  source: unknown
  ports: readonly MessagePort[]
}
export type StreamScope = {
  location: { origin: string }
  skipWaiting(): Promise<void>
  clients: {
    get(id: string): Promise<StreamClient | undefined>
    claim(): Promise<void>
  }
  addEventListener(type: 'install' | 'activate', listener: (event: WaitUntil) => void): void
  addEventListener(type: 'message', listener: (event: StreamMessageEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: StreamFetchEvent) => void): void
}
type Metadata = Pick<
  SourceDetails,
  'objectId' | 'sealed' | 'name' | 'mime' | 'size'
>
type Chunks = ReadableStreamDefaultReader<Uint8Array>

/** One page's open share, and the SDK the worker connects for it on first use. */
type Session = {
  key: string
  connection: Connection
  sources: Set<Source>
  objects: Map<string, Promise<PinnedObject>>
  // One `Job.lifetime` per request in flight.
  jobs: Set<Promise<void>>
  closed: boolean
  timer?: ReturnType<typeof setTimeout>
  sdk?: Promise<StreamSdk>
}

/** One stream token, resolved to its file by asking the page that made it. */
type Source = {
  key: string
  client: StreamClient
  closed: boolean
  // The `abort` of each job serving this token.
  requests: Set<() => void>
  ready: Promise<Metadata>
  setup: AbortController
  session?: Session
  // Set when the page asked for status and progress messages.
  reporter?: Reporter
  // Requests for this URL past their HEAD and range checks and not yet
  // settled. Its status is `idle` while this is zero.
  reading: number
}

/** One HTTP request for a stream URL, from the first await to its last byte. */
type Job = {
  closed: boolean
  lifetime: Promise<void>
  source?: Source
  session?: Session
  range?: ByteRange
  // Counted in `source.reading` until the job settles.
  reading?: boolean
  // A warm-up read, which reports nothing to the page.
  quiet?: boolean
  reader?: Chunks
  controller?: ReadableStreamDefaultController<Uint8Array>
  finish(cancel?: boolean): void
  abort(): void
  fail(error: unknown): void
}

// The control port carries credentials and metadata only. Bytes never leave
// this worker, since each response consumes the SDK's own stream with native
// backpressure.
export function serveStreams(
  scope: StreamScope,
  connect: (connection: Connection) => Promise<StreamSdk>,
  supportsDownloads: boolean,
) {
  const sources = new Map<string, Source>()
  const sessions = new Map<string, Session>()
  // Released session keys. A page reply already in flight when its share is
  // released must not bring the session back.
  const released = new Set<string>()
  const key = (clientId: string, id: string) => JSON.stringify([clientId, id])

  function idle(session: Session) {
    clearTimeout(session.timer)
    if (!session.closed && session.jobs.size === 0) {
      session.timer = setTimeout(
        () => void disposeSession(session),
        IDLE_TIMEOUT,
      )
    }
  }

  function sessionFor(clientId: string, details: SourceDetails) {
    const sessionKey = key(clientId, details.session)
    let session = sessions.get(sessionKey)
    if (!session) {
      session = {
        key: sessionKey,
        connection: details.connection,
        sources: new Set(),
        objects: new Map(),
        jobs: new Set(),
        closed: false,
      }
      sessions.set(sessionKey, session)
    }
    return session
  }

  async function disposeSession(session: Session) {
    if (session.closed) return
    session.closed = true
    sessions.delete(session.key)
    clearTimeout(session.timer)
    for (const source of session.sources) dropSource(source)
    // Do not free wasm handles while a connect, lookup or cancellation uses them.
    await Promise.allSettled(session.jobs)
    await Promise.allSettled(
      [...session.objects.values()].map(async (object) =>
        (await object).free(),
      ),
    )
    try {
      ;(await session.sdk)?.free()
    } catch {
      // Connection failures are reported by the request, not during disposal.
    }
  }

  // A failed connect or lookup is forgotten, so the next request retries it
  // instead of failing with the cached error.
  function sdkFor(session: Session) {
    if (session.sdk) return session.sdk
    const { connection } = session
    const connecting = Promise.resolve().then(() => connect(connection))
    session.sdk = connecting
    connecting.catch(() => {
      if (session.sdk === connecting) delete session.sdk
    })
    return connecting
  }

  function objectFor(session: Session, sdk: StreamSdk, ref: ObjectRef) {
    const { objectId } = ref
    const cached = session.objects.get(objectId)
    if (cached) return cached
    const lookup = Promise.resolve().then(() => sdk.object(ref))
    session.objects.set(objectId, lookup)
    lookup.catch(() => {
      if (session.objects.get(objectId) === lookup) {
        session.objects.delete(objectId)
      }
    })
    return lookup
  }

  function getSource(client: StreamClient, token: string) {
    const sourceKey = key(client.id, token)
    const cached = sources.get(sourceKey)
    if (cached) return cached
    const setup = new AbortController()
    const request = { type: 'sia-source', token } satisfies WorkerMessage
    const ready = requestReply(client, request, {
      timeout: SOURCE_TIMEOUT,
      signal: setup.signal,
    }).then((reply) => {
      if (!isSourceReply(reply)) {
        throw new Error('Shared file source unavailable.')
      }
      if (source.closed || released.has(key(client.id, reply.session))) {
        throw new DOMException('Released', 'AbortError')
      }
      const session = sessionFor(client.id, reply)
      source.session = session
      session.sources.add(source)
      if (reply.events?.length) {
        source.reporter = createReporter(client, token, reply.events)
      }
      idle(session)
      // Keep credentials in the session record, never in response metadata.
      const { objectId, sealed, name, mime, size } = reply
      return { objectId, sealed, name, mime, size }
    })
    const source: Source = {
      key: sourceKey,
      client,
      closed: false,
      requests: new Set(),
      ready,
      setup,
      reading: 0,
    }
    sources.set(sourceKey, source)
    return source
  }

  function dropSource(source: Source) {
    if (source.closed) return
    source.closed = true
    sources.delete(source.key)
    source.reporter?.stop()
    source.setup.abort(new DOMException('Released', 'AbortError'))
    for (const cancel of source.requests) cancel()
    source.session?.sources.delete(source)
  }

  /**
   * Tracks one request until it settles, whichever way that happens: its last
   * byte, the page aborting it, its source being released, or an SDK failure.
   */
  function startJob(request: Request, token: string): Job {
    let complete = () => {}
    // Kept out of event.waitUntil. Chromium kills a worker whose event runs
    // past 5 minutes, which would end any download still running at that mark.
    const lifetime = new Promise<void>((resolve) => {
      complete = resolve
    })
    const job: Job = {
      closed: false,
      lifetime,
      finish(cancel = false) {
        if (job.closed) return
        job.closed = true
        request.signal.removeEventListener('abort', job.abort)
        const { reader } = job
        const cancellation =
          cancel && reader ? reader.cancel().catch(() => {}) : undefined
        void Promise.resolve(cancellation).finally(() => {
          reader?.releaseLock()
          const { source } = job
          source?.requests.delete(job.abort)
          if (source && job.reading && --source.reading === 0) {
            source.reporter?.status('idle')
          }
          job.session?.jobs.delete(lifetime)
          if (job.session) idle(job.session)
          complete()
        })
      },
      abort() {
        if (job.closed) return
        job.controller?.error(new DOMException('Aborted', 'AbortError'))
        job.finish(true)
      },
      fail(error) {
        if (job.closed) return
        const message = streamErrorMessage(error)
        const aborted = error instanceof Error && error.name === 'AbortError'
        const { source, range } = job
        // A warm-up is invisible to the page, failures included. The play
        // that follows connects again and reports its own failure.
        if (!aborted && !job.quiet && source && !source.closed) {
          // Diagnostics go only to the owning page. Never log SDK objects here.
          try {
            source.client.postMessage({
              type: 'sia-stream-error',
              token,
              message,
              ...(range && { offset: range.offset, length: range.length }),
            } satisfies WorkerMessage)
          } catch {
            // The owning tab may already be gone.
          }
        }
        job.controller?.error(new Error(message))
        job.finish(true)
      },
    }
    return job
  }

  async function serve(
    request: Request,
    clientId: string,
    token: string,
    { download, warm }: { download: boolean; warm: boolean },
  ): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return errorResponse(405)
    }
    if (!supportsDownloads) return errorResponse(503)
    const job = startJob(request, token)
    job.quiet = warm
    try {
      const client = await scope.clients.get(clientId)
      if (!client || request.signal.aborted) return errorResponse(404)
      const source = getSource(client, token)
      job.source = source
      source.requests.add(job.abort)
      request.signal.addEventListener('abort', job.abort, { once: true })
      const metadata = await source.ready
      if (job.closed) return errorResponse(502)
      // Set by `ready` before it resolves.
      const session = source.session!
      job.session = session
      session.jobs.add(job.lifetime)
      clearTimeout(session.timer)
      const range = parseRange(
        request.method === 'HEAD' ? null : request.headers.get('range'),
        metadata.size,
      )
      job.range = range
      const headers = responseHeaders(metadata, range, download)
      if (request.method === 'HEAD' || range.status === 416) {
        job.finish()
        return new Response(null, { status: range.status, headers })
      }
      // A warm-up is invisible to the page, so a player that warms a file
      // does not see it go connecting and downloading before Play.
      const reporter = warm ? undefined : source.reporter
      job.reading = !warm
      // A read that starts while another is already downloading leaves the
      // status at `downloading`.
      if (!warm && ++source.reading === 1) reporter?.status('connecting')
      // A zero-byte file reports connecting then idle, as a read in the page
      // does, without starting an SDK download.
      if (range.length === 0) {
        job.finish()
        return new Response(null, { status: range.status, headers })
      }
      const sdk = await sdkFor(session)
      if (job.closed) return errorResponse(502)
      const object = await objectFor(session, sdk, metadata)
      if (job.closed) return errorResponse(502)
      const chunks: Chunks = sdk
        .download(object, {
          offset: range.offset,
          length: range.length,
          ...(reporter?.wants.shards && {
            onShardDownloaded: (progress) => reporter.shard(progress),
          }),
        })
        .getReader()
      job.reader = chunks
      return new Response(rangeBody(job, chunks, range.length), {
        status: range.status,
        headers,
      })
    } catch (error) {
      job.fail(error)
      if (job.source && !job.source.session) dropSource(job.source)
      return errorResponse(502)
    }
  }

  scope.addEventListener('install', (event) =>
    event.waitUntil(scope.skipWaiting()),
  )
  scope.addEventListener('activate', (event) =>
    event.waitUntil(scope.clients.claim()),
  )
  scope.addEventListener('message', (event) => {
    const source = event.source as Partial<StreamClient> | null
    const clientId = typeof source?.id === 'string' ? source.id : undefined
    if (!clientId) return
    const data = event.data as PageMessage | undefined
    if (data?.type === 'sia-client') {
      const reply: ClientReply = { clientId, supported: supportsDownloads }
      event.ports[0]?.postMessage(reply)
      event.ports[0]?.close()
    } else if (data?.type === 'sia-release' && typeof data.token === 'string') {
      // The session outlives its last source until IDLE_TIMEOUT, so moving to
      // the next file reuses the connected SDK.
      const source = sources.get(key(clientId, data.token))
      if (source) dropSource(source)
    } else if (
      data?.type === 'sia-release-share' &&
      typeof data.session === 'string'
    ) {
      const sessionKey = key(clientId, data.session)
      released.add(sessionKey)
      const session = sessions.get(sessionKey)
      if (session) event.waitUntil(disposeSession(session))
    }
  })
  scope.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)
    if (url.origin !== scope.location.origin) return
    const stream = parseStreamPath(url.pathname)
    if (!stream) return
    const download = url.searchParams.get('download') === '1'
    const warm = url.searchParams.get('warm') === '1'
    event.respondWith(
      serve(event.request, stream.clientId, stream.token, { download, warm }),
    )
  })
}

/**
 * Exactly `length` bytes from `chunks`, or an error if the SDK stream ends
 * early or runs over. Each pull reads one chunk, so backpressure reaches the SDK.
 */
function rangeBody(job: Job, chunks: Chunks, length: number) {
  let remaining = length
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        job.controller = controller
      },
      async pull(controller) {
        try {
          const { done, value } = await chunks.read()
          if (job.closed) return
          if (done) {
            if (remaining !== 0) {
              throw new Error(
                'Shared file stream ended before all bytes arrived.',
              )
            }
            controller.close()
            job.finish()
            return
          }
          remaining -= value.byteLength
          if (remaining < 0) {
            throw new Error('Shared file stream exceeded the requested length.')
          }
          controller.enqueue(value)
          const reporter = job.quiet ? undefined : job.source?.reporter
          reporter?.status('downloading')
          reporter?.bytes(value.byteLength)
          if (remaining === 0) {
            controller.close()
            job.finish(true)
          }
        } catch (error) {
          job.fail(error)
        }
      },
      cancel() {
        job.finish(true)
        return job.lifetime
      },
    },
    { highWaterMark: 0 },
  )
}

type Reporter = {
  wants: { shards: boolean }
  status(status: StreamStatus): void
  bytes(count: number): void
  shard(progress: ShardProgress): void
  stop(): void
}

/**
 * Status and progress messages for one stream URL, sent to the page that made
 * it. Statuses go at once and only when they change. Bytes and shards collect
 * for REPORT_INTERVAL. After `stop`, every call does nothing, since the SDK
 * can still report a shard from a download being cancelled.
 */
function createReporter(
  client: StreamClient,
  token: string,
  events: StreamEvent[],
): Reporter {
  const wants = {
    status: events.includes('status'),
    progress: events.includes('progress'),
    shards: events.includes('shards'),
  }
  let stopped = false
  let current: StreamStatus | undefined
  let bytes = 0
  let shards: ShardProgress[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  function post(message: WorkerMessage) {
    try {
      client.postMessage(message)
    } catch {
      // The owning tab may already be gone.
    }
  }
  function flush() {
    clearTimeout(timer)
    timer = undefined
    if (stopped || (bytes === 0 && shards.length === 0)) return
    post({ type: 'sia-stream-progress', token, bytes, shards })
    bytes = 0
    shards = []
  }
  function schedule() {
    timer ??= setTimeout(flush, REPORT_INTERVAL)
  }
  function status(next: StreamStatus) {
    if (stopped || next === current) return
    flush()
    current = next
    if (wants.status) post({ type: 'sia-stream-status', token, status: next })
  }

  return {
    wants,
    status,
    bytes(count) {
      if (stopped || !wants.progress) return
      bytes += count
      schedule()
    },
    shard({ hostKey, shardSize, shardIndex, slabIndex, elapsedMs }) {
      if (stopped) return
      // Copied field by field, so only plain data crosses to the page.
      shards.push({ hostKey, shardSize, shardIndex, slabIndex, elapsedMs })
      schedule()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      timer = undefined
      shards = []
    },
  }
}
