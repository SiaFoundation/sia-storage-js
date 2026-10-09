/**
 * The page side of streaming.
 *
 * `openStreams` hands out same-origin URLs that the library's service worker
 * answers with ranged reads of an object, so a `<video>` seeks without loading
 * the whole file and a download goes to the browser's download manager instead
 * of the page's memory. The worker connects its own SDK of the same kind, with
 * credentials this page hands it over a message port and it keeps in memory.
 * Where the worker is unavailable, the same calls read the object in the page.
 */
import type {
  AppMetadata,
  PinnedObject,
  SealedObject,
  Sdk,
  SharedSdk,
} from '../../wasm/sia_storage_wasm.js'
import { AppKey } from '../wasm'
import { reportStreamError, streamErrorMessage } from './errors'
import { type FileEvents, notify, readBlob, saveToDisk } from './fallback'
import {
  type ClientReply,
  type Connection,
  isAppMetadata,
  type PageMessage,
  requestReply,
  type SourceReply,
  type StreamEvent,
  streamPath,
  type WorkerMessage,
} from './protocol'

export type { FileEvents } from './fallback'
export type { StreamStatus } from './protocol'

export type StreamingOptions = {
  /** Where the site serves the worker file. Defaults to `/sia-storage-sw.js`. */
  workerUrl?: string
  /** The worker's scope. Defaults to the directory `workerUrl` is in. */
  scope?: string
  /** `'module'` when `workerUrl` is an ES module worker of your own. */
  type?: WorkerType
}

/** What a `SharedSdk` was connected with. */
export type SharedCredentials = { indexerUrl: string; seed: string }

/** What an `Sdk`'s `Builder` was made with. The key comes from `sdk.appKey()`. */
export type AppCredentials = { indexerUrl: string; appMeta: AppMetadata }

/** The credentials `openStreams` takes for each kind of SDK. */
export type CredentialsFor<S extends Sdk | SharedSdk> = S extends SharedSdk
  ? SharedCredentials
  : AppCredentials

export type FileOptions = FileEvents & {
  /** Used for downloads and for the browser's media handling. */
  name: string
  /** The MIME type. Defaults to `application/octet-stream`. */
  type?: string
  /** A failure after streaming started. Without it, failures are logged. */
  onError?: (message: string) => void
}

/** A URL for an `<img>`, `<video>`, `<audio>`, `<iframe>` or `fetch`. */
export type StreamedFile = {
  url: string
  /** The whole file, when the page read it itself instead of streaming. */
  blob?: Blob
  /**
   * Opens connections to the hosts holding the start of the file, so a play
   * that follows gets its first bytes sooner. It reads one byte, which asks
   * each host of the first slab for a single 64-byte segment, and reports no
   * status or progress. Resolves when the byte arrives, or at once for a file
   * the page read itself. Never rejects, since a play still works without it.
   * Call it when a play is likely, such as when the pointer reaches a Play
   * button. The earlier before the play, the more it saves.
   */
  warm(): Promise<void>
  /** Frees the URL. Call it when the element showing it goes away. */
  release(): void
}

export type Streams = {
  /** A URL serving the object. Streams where it can, else reads it whole. */
  url(
    object: PinnedObject,
    options: FileOptions & { signal?: AbortSignal },
  ): Promise<StreamedFile>
  /**
   * Saves the object, from a click handler. Streams to the browser's download
   * manager where it can, else opens the save picker, else saves a Blob.
   * Awaits nothing before the picker opens, so the browser still counts it as
   * part of the click.
   */
  download(
    object: PinnedObject,
    options: FileOptions,
  ): Promise<'streaming' | 'saved' | 'cancelled'>
  /**
   * Cancels the streams this handle made. Other handles on the same SDK keep
   * theirs. Call it when you stop using the handle.
   */
  close(): void
}

const DEFAULT_WORKER_URL = '/sia-storage-sw.js'
// Covers registering the worker, its first activation, and the handshake.
const SETUP_TIMEOUT = 5000

/** A stream URL this page handed out, and what the worker needs to serve it. */
type StreamEntry = {
  handle: Opened
  objectId: string
  sealed: SealedObject | undefined
  size: number
  name: string
  mime: string
  onError: ((message: string) => void) | undefined
  events: FileEvents
  // Bytes reported for this URL so far, across all of its range requests.
  received: number
}

/**
 * One `openStreams` call, and how the worker reconnects its SDK. Each call gets
 * its own session, so closing one handle leaves another on the same SDK open.
 *
 * `sealKey` seals each object the page streams, so the worker opens it instead
 * of asking the indexer for it again. An `Sdk`'s is a copy of its app key. A
 * `SharedSdk` has none, so it gets a random key that only this page and its
 * worker see. Either is freed on close.
 */
type Opened = { session: string; connection: Connection; sealKey?: AppKey }

const entries = new Map<string, StreamEntry>()
const opened = new Set<Opened>()
let worker: { clientId: string; scope: string } | undefined
let initialization: Promise<boolean> | undefined
let initOptions: StreamingOptions = {}
// The page's controller when setup last failed. Undefined unless it failed.
let failedController: ServiceWorker | null | undefined

/**
 * Registers the streaming worker and resolves whether this page can stream.
 * `openStreams` calls it with the defaults, so call it yourself only to pass
 * options, and before the first `openStreams`. Later calls return the first
 * call's answer, except when setup failed or timed out and a different worker
 * has since taken control of the page. Then the next call tries again, with
 * the first call's options.
 */
export function enableStreaming(
  options: StreamingOptions = {},
): Promise<boolean> {
  if (!initialization) {
    initOptions = options
  } else if (failedController === undefined) {
    return initialization
  } else {
    // Only a new controller is worth a retry. Retrying against the same one,
    // or none, would wait out SETUP_TIMEOUT again on every call.
    const controller = navigator.serviceWorker.controller
    if (!controller || controller === failedController) return initialization
  }
  failedController = undefined
  initialization = initialize(initOptions).catch(() => {
    failedController = navigator.serviceWorker.controller
    return false
  })
  return initialization
}

async function initialize({
  workerUrl = DEFAULT_WORKER_URL,
  scope,
  type,
}: StreamingOptions) {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !window.isSecureContext
  ) {
    return false
  }
  const { serviceWorker } = navigator
  serviceWorker.addEventListener('message', onWorkerMessage)
  const deadline = AbortSignal.timeout(SETUP_TIMEOUT)
  // A hard reload (Shift+Reload) loads the page without its worker, and an
  // active worker only claims pages when it first activates. Waiting would
  // run out the whole deadline, so fall back at once.
  const existing = await within(serviceWorker.getRegistration(), deadline)
  if (existing?.active && !serviceWorker.controller) return false
  const registration = await within(
    serviceWorker
      .register(workerUrl, { ...(scope && { scope }), ...(type && { type }) })
      .then(() => serviceWorker.ready),
    deadline,
  )
  // On a first visit, the page is controlled once the new worker claims it.
  if (!serviceWorker.controller) {
    await within(
      new Promise((resolve) =>
        serviceWorker.addEventListener('controllerchange', resolve, {
          once: true,
        }),
      ),
      deadline,
    )
  }
  const controller = serviceWorker.controller
  if (!controller) return false
  const request = { type: 'sia-client' } satisfies PageMessage
  const reply = (await requestReply(controller, request, {
    signal: deadline,
  })) as ClientReply
  if (!reply.supported) return false
  worker = { clientId: reply.clientId, scope: registration.scope }
  return true
}

/** `promise`, or a rejection if `signal` aborts first. */
function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    })
    promise.then(resolve, reject)
  })
}

/**
 * Previews and downloads for one SDK's objects, from an `Sdk` or a `SharedSdk`.
 *
 * The worker cannot use this page's SDK, so it connects its own with
 * `credentials`: the indexer URL and seed a `SharedSdk` was connected with, or
 * the indexer URL and app metadata an `Sdk`'s `Builder` was made with.
 */
export function openStreams<S extends Sdk | SharedSdk>(
  sdk: S,
  credentials: CredentialsFor<S>,
): Streams {
  const handle = openedFor(sdk, credentials)
  opened.add(handle)
  // Started now, so it has usually finished by the first download click,
  // which cannot wait for it.
  void enableStreaming()
  return {
    async url(object, options) {
      await enableStreaming()
      options.signal?.throwIfAborted()
      const stream = streamUrl(handle, object, options)
      if (stream) return stream
      const blob = await readBlob(
        sdk,
        object,
        options.type,
        options,
        options.signal ?? new AbortController().signal,
      )
      const url = URL.createObjectURL(blob)
      return {
        url,
        blob,
        warm: async () => {},
        release: () => URL.revokeObjectURL(url),
      }
    },
    async download(object, options) {
      const stream = streamUrl(handle, object, options)
      if (stream) {
        // A hidden frame, so a worker error loads there instead of replacing
        // the page. Nothing signals when the download has started, so it stays.
        const frame = document.createElement('iframe')
        frame.hidden = true
        frame.src = `${stream.url}?download=1`
        document.body.append(frame)
        // Never released here. The URL stays valid until `close()`, so
        // delayed starts and browser retries still work.
        return 'streaming'
      }
      const saved = await saveToDisk(
        sdk,
        object,
        options.name,
        options.type,
        options,
      )
      return saved ? 'saved' : 'cancelled'
    },
    close() {
      releaseStreams(handle)
    },
  }
}

/**
 * Checked at runtime too, for callers without types. An `Sdk` is told apart
 * by its `appKey()`, which a `SharedSdk` does not have.
 */
function openedFor(sdk: Sdk | SharedSdk, credentials: unknown): Opened {
  const { indexerUrl, seed, appMeta } = (credentials ?? {}) as {
    indexerUrl?: unknown
    seed?: unknown
    appMeta?: unknown
  }
  const session = crypto.randomUUID()
  if (typeof (sdk as Partial<Sdk>).appKey === 'function') {
    if (typeof indexerUrl !== 'string' || !isAppMetadata(appMeta)) {
      throw new TypeError('openStreams(Sdk) needs { indexerUrl, appMeta }.')
    }
    const appKey = (sdk as Sdk).appKey()
    const connection: Connection = {
      kind: 'app',
      indexerUrl,
      appKey: toHex(appKey.export()),
      appMeta,
    }
    return { session, connection, sealKey: appKey }
  }
  if (typeof indexerUrl !== 'string' || typeof seed !== 'string') {
    throw new TypeError('openStreams(SharedSdk) needs { indexerUrl, seed }.')
  }
  const sealing = randomSealKey()
  return {
    session,
    connection: {
      kind: 'shared',
      indexerUrl,
      seed,
      ...(sealing && { sealKey: sealing.hex }),
    },
    ...(sealing && { sealKey: sealing.key }),
  }
}

/**
 * Undefined when the SDK's WebAssembly is not running, which a page holding a
 * connected `SharedSdk` has always started. The worker then looks objects up.
 */
function randomSealKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  try {
    return { key: new AppKey(bytes), hex: toHex(bytes) }
  } catch {
    return undefined
  }
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function streamUrl(
  handle: Opened,
  object: PinnedObject,
  { name, type, onError, onProgress, onShard, onStatus }: FileOptions,
): StreamedFile | undefined {
  if (!worker || !navigator.serviceWorker.controller || !opened.has(handle)) {
    return undefined
  }
  const token = crypto.randomUUID()
  entries.set(token, {
    handle,
    objectId: object.id(),
    sealed: handle.sealKey && object.seal(handle.sealKey),
    size: object.size(),
    name,
    mime: type || 'application/octet-stream',
    onError,
    events: { onProgress, onShard, onStatus },
    received: 0,
  })
  const url = streamPath(worker.scope, worker.clientId, token)
  return {
    url,
    async warm() {
      try {
        const response = await fetch(`${url}?warm=1`, {
          headers: { Range: 'bytes=0-0' },
        })
        await response.arrayBuffer()
      } catch {
        // A play after a failed warm-up connects as it would have anyway.
      }
    },
    release() {
      entries.delete(token)
      const message = { type: 'sia-release', token } satisfies PageMessage
      navigator.serviceWorker.controller?.postMessage(message)
    },
  }
}

function releaseStreams(handle: Opened) {
  for (const [token, entry] of entries) {
    if (entry.handle === handle) entries.delete(token)
  }
  if (!opened.delete(handle)) return
  handle.sealKey?.free()
  const message = {
    type: 'sia-release-share',
    session: handle.session,
  } satisfies PageMessage
  navigator.serviceWorker.controller?.postMessage(message)
}

function onWorkerMessage(event: MessageEvent) {
  if (event.source !== navigator.serviceWorker.controller) return
  const data = event.data as WorkerMessage | undefined
  if (data?.type === 'sia-stream-error') {
    const entry = entries.get(data.token)
    if (!entry) return
    const { offset, length } = data
    const range =
      offset !== undefined && length !== undefined
        ? { offset, length }
        : undefined
    if (entry.onError) entry.onError(streamErrorMessage(data.message))
    else reportStreamError(data.message, entry.name, range)
  } else if (data?.type === 'sia-stream-status') {
    notify(entries.get(data.token)?.events.onStatus, data.status)
  } else if (data?.type === 'sia-stream-progress') {
    const entry = entries.get(data.token)
    // The worker can come from a different deploy, so its fields are checked.
    if (!entry || !Array.isArray(data.shards)) return
    const { onProgress, onShard } = entry.events
    for (const shard of data.shards) notify(onShard, shard)
    if (Number.isSafeInteger(data.bytes) && data.bytes > 0) {
      entry.received += data.bytes
      notify(onProgress, entry.received)
    }
  } else if (data?.type === 'sia-source') {
    const port = event.ports[0]
    if (!port) return
    const entry = entries.get(data.token)
    const events: StreamEvent[] = []
    if (entry?.events.onStatus) events.push('status')
    if (entry?.events.onProgress) events.push('progress')
    if (entry?.events.onShard) events.push('shards')
    const reply: SourceReply =
      entry
        ? {
            type: 'source',
            session: entry.handle.session,
            connection: entry.handle.connection,
            objectId: entry.objectId,
            ...(entry.sealed && { sealed: entry.sealed }),
            size: entry.size,
            mime: entry.mime,
            name: entry.name,
            ...(events.length > 0 && { events }),
          }
        : { type: 'error' }
    port.postMessage(reply)
    port.close()
  }
}
