/**
 * Messages between a page and its streaming service worker.
 *
 * Stream URLs carry only the page's client id and a random token. When the
 * worker meets a token it does not know, it asks the page that made it for the
 * file and the share's credentials. The page and a worker can come from
 * different deployed versions, so the worker checks the page's reply before
 * using it.
 */
import type {
  AppMetadata,
  SealedObject,
  ShardProgress,
} from '../../wasm/sia_storage_wasm.js'

/**
 * What a stream URL is doing. `connecting` is a request waiting for its first
 * bytes, which on the URL's first request includes the worker connecting its
 * SDK and finding the object. `downloading` means bytes are arriving. `idle`
 * means no request for the URL is in flight, after the last one finished, was
 * cancelled or failed.
 */
export type StreamStatus = 'connecting' | 'downloading' | 'idle'

/** The reports a page can ask for, one per callback it was given. */
export type StreamEvent = 'status' | 'progress' | 'shards'
const STREAM_EVENTS: readonly unknown[] = ['status', 'progress', 'shards']

/**
 * What the worker connects its own SDK with. A `SharedSdk` reconnects from its
 * sharing key's seed, and an `Sdk` from its app key, as hex, and app metadata.
 */
export type Connection =
  | { kind: 'shared'; indexerUrl: string; seed: string }
  | { kind: 'app'; indexerUrl: string; appKey: string; appMeta: AppMetadata }

export type SourceDetails = {
  // One per opened SDK, so the worker can release it as a whole.
  session: string
  connection: Connection
  objectId: string
  // An `Sdk`'s object, sealed with its app key, so the worker can open it
  // without a lookup. A `SharedSdk`'s object is looked up by `objectId`.
  sealed?: SealedObject
  name: string
  mime: string
  size: number
  // The reports the page wants for this URL. The worker sends no others, and
  // asks the SDK for shard reports only when `shards` is here.
  events?: StreamEvent[]
}

/** Page to worker. */
export type PageMessage =
  | { type: 'sia-client' }
  | { type: 'sia-release'; token: string }
  | { type: 'sia-release-share'; session: string }

/** Worker to page. */
export type WorkerMessage =
  | { type: 'sia-source'; token: string }
  | {
      type: 'sia-stream-error'
      token: string
      message: string
      offset?: number
      length?: number
    }
  | { type: 'sia-stream-status'; token: string; status: StreamStatus }
  | {
      type: 'sia-stream-progress'
      token: string
      // Bytes served since the previous progress message.
      bytes: number
      shards: ShardProgress[]
    }

/** The worker's answer to `sia-client`. */
export type ClientReply = { clientId: string; supported: boolean }

/** The page's answer to `sia-source`. */
export type SourceReply =
  | ({ type: 'source' } & SourceDetails)
  | { type: 'error' }

// Stream URLs sit under the worker's scope, so a download's navigation, which
// only a worker whose scope covers the URL can answer, reaches it on sites
// served from a sub-path too.
const STREAM_PATH = /\/__sia_stream__\/([^/]+)\/([^/]+)\/[^/]+$/

/** `scope` is the worker registration's scope URL, which ends in a slash. */
export function streamPath(scope: string, clientId: string, token: string) {
  return `${scope}__sia_stream__/${clientId}/${token}/file`
}

export function parseStreamPath(pathname: string) {
  const match = STREAM_PATH.exec(pathname)
  return match ? { clientId: match[1]!, token: match[2]! } : undefined
}

type Fields = Record<string, unknown> | null | undefined

const strings = (data: Fields, fields: string[]) =>
  fields.every((field) => typeof data?.[field] === 'string')

/** Checked on both sides, so bad metadata fails in `openStreams`, not per request. */
export function isAppMetadata(value: unknown): value is AppMetadata {
  return strings(value as Fields, ['appId', 'name', 'description', 'serviceUrl'])
}

function isConnection(value: unknown): value is Connection {
  const data = value as Fields
  if (data?.kind === 'shared') return strings(data, ['indexerUrl', 'seed'])
  return (
    data?.kind === 'app' &&
    strings(data, ['indexerUrl', 'appKey']) &&
    isAppMetadata(data.appMeta)
  )
}

export function isSourceReply(
  reply: unknown,
): reply is { type: 'source' } & SourceDetails {
  const data = reply as Fields
  return (
    data?.type === 'source' &&
    strings(data, ['session', 'objectId', 'name', 'mime']) &&
    isConnection(data.connection) &&
    (data.connection.kind === 'shared' ||
      (typeof data.sealed === 'object' && data.sealed !== null)) &&
    Number.isSafeInteger(data.size) &&
    (data.size as number) >= 0 &&
    (data.events === undefined ||
      (Array.isArray(data.events) &&
        data.events.every((event) => STREAM_EVENTS.includes(event))))
  )
}

/**
 * Posts `message` with a reply port and resolves with the first reply. Rejects
 * after `timeout` ms, or when `signal` aborts.
 */
export function requestReply(
  target: { postMessage(message: unknown, transfer: Transferable[]): void },
  message: unknown,
  { timeout, signal }: { timeout?: number; signal?: AbortSignal },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel()
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(
            () => settle(() => reject(new Error('No reply in time.'))),
            timeout,
          )
    const abort = () => settle(() => reject(signal?.reason))
    function settle(outcome: () => void) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      port1.close()
      port2.close()
      outcome()
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    port1.onmessage = ({ data }) => settle(() => resolve(data))
    port1.onmessageerror = () =>
      settle(() => reject(new Error('Unreadable reply.')))
    try {
      target.postMessage(message, [port2])
    } catch (error) {
      settle(() => reject(error))
    }
  })
}
