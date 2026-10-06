// The page side of the streaming tests. It drives the public stream API with a
// stand-in SDK, a SharedSdk or an app Sdk, whose own downloads throw unless a
// test allows the fallback, so a test fails if bytes it expects the worker to
// serve come through the page.
import type {
  AppMetadata,
  PinnedObject,
  Sdk,
  SharedSdk,
} from '../../../../wasm/sia_storage_wasm.js'
import { enableStreaming, openStreams } from '../../../stream/page'
import { requestReply } from '../../../stream/protocol'
import type { FixtureConfig, FixtureStats } from './worker'

function object(size: number, wav = false) {
  const id = `${wav ? 'wav' : 'bytes'}:${size}`
  return {
    id: () => id,
    size: () => size,
    // Stands in for sealing with the app key. The fixture worker reads the id.
    seal: () => ({ id }),
  } as unknown as PinnedObject
}

const APP_META: AppMetadata = {
  appId: '0'.repeat(64),
  name: 'Streaming fixture',
  description: 'Tests',
  serviceUrl: 'https://fixture.invalid',
  logoUrl: undefined,
  callbackUrl: undefined,
}

/** What `openStreams` throws for these credentials, or undefined. */
export function openError(kind: 'shared' | 'app', credentials: unknown) {
  const sdk = kind === 'app' ? { appKey: () => ({ export: () => new Uint8Array(32) }) } : {}
  try {
    openStreams(sdk as Sdk, credentials as never)
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

async function rpc(config?: FixtureConfig) {
  const worker = navigator.serviceWorker.controller!
  const message = { type: 'fixture-stats', config }
  return (await requestReply(worker, message, {
    timeout: 5000,
  })) as FixtureStats
}

export async function setup(workerUrl: string, kind: 'shared' | 'app' = 'shared') {
  let pageDownloads = 0
  let fallback = false
  const sdk = {
    ...(kind === 'app' && {
      appKey: () => ({ export: () => new Uint8Array(32).fill(7) }),
    }),
    download(object: PinnedObject) {
      pageDownloads++
      if (!fallback) throw new Error('Streaming download ran on the page')
      return new ReadableStream({
        start(controller) {
          controller.enqueue(
            Uint8Array.from({ length: object.size() }, (_, i) => i % 251),
          )
          controller.close()
        },
      })
    },
  }
  const ready = await enableStreaming({ workerUrl })
  const indexerUrl = 'https://fixture.invalid'
  const open = () =>
    kind === 'app'
      ? openStreams(sdk as unknown as Sdk, { indexerUrl, appMeta: APP_META })
      : openStreams(sdk as unknown as SharedSdk, { indexerUrl, seed: 'ab'.repeat(32) })
  const streams = open()
  let releaseOne = () => {}
  const errors: string[] = []
  const onError = (message: string) => errors.push(message)
  // What the last URL or download made with `track` reported.
  let tracked = { statuses: [] as string[], progress: [] as number[], hosts: [] as string[] }
  // The event callbacks, recording into a fresh `tracked`. With `throwing`,
  // onShard throws after recording, as a buggy app callback would. With
  // `statusOnly`, only onStatus is passed.
  const track = (throwing = false, statusOnly = false) => {
    const record = { statuses: [] as string[], progress: [] as number[], hosts: [] as string[] }
    tracked = record
    const onStatus = (status: string) => void record.statuses.push(status)
    if (statusOnly) return { onStatus }
    return {
      onStatus,
      onProgress: (bytes: number) => void record.progress.push(bytes),
      onShard: (shard: { hostKey: string }) => {
        record.hosts.push(shard.hostKey)
        if (throwing) throw new Error('App callback failed')
      },
    }
  }
  // Status and progress messages the page received, for any URL.
  const messages = { status: 0, progress: 0 }
  navigator.serviceWorker.addEventListener('message', (event) => {
    const type = (event.data as { type?: string } | null)?.type
    if (type === 'sia-stream-status') messages.status++
    if (type === 'sia-stream-progress') messages.progress++
  })
  return {
    ready,
    errors,
    pageDownloads: () => pageDownloads,
    tracked: () => tracked,
    eventMessages: () => messages.status + messages.progress,
    progressMessages: () => messages.progress,
    stats: () => rpc(),
    configure: (config: FixtureConfig) => rpc(config),
    allowFallback: () => {
      fallback = true
    },
    /** A URL for a generated object. `logged` leaves failures to the console. */
    async create(
      size: number,
      name = 'generated.bin',
      { wav = false, logged = false, tracked = false, throwing = false, statusOnly = false } = {},
    ) {
      const file = await streams.url(object(size, wav), {
        name,
        type: wav ? 'audio/wav' : 'application/octet-stream',
        ...(!logged && { onError }),
        ...(tracked && track(throwing, statusOnly)),
      })
      releaseOne = file.release
      return { url: file.url, fromPage: file.blob !== undefined }
    },
    releaseOne: () => releaseOne(),
    close: () => streams.close(),
    /** Opens a second handle on the same SDK, makes a URL with it, then closes it. */
    async closeAnother(size: number) {
      const other = open()
      const file = await other.url(object(size), { name: 'other.bin', onError })
      other.close()
      return file.url
    },
    save: (size: number, name: string, { tracked = false } = {}) =>
      streams.download(object(size), {
        name,
        type: 'application/octet-stream',
        onError,
        ...(tracked && track()),
      }),
  }
}

export type Harness = Awaited<ReturnType<typeof setup>> & {
  reader?: ReadableStreamDefaultReader<Uint8Array>
  abort?: AbortController
}

declare global {
  interface Window {
    streamTest: Harness
    mediaLog?: string[]
  }
}
