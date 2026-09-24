// A streaming worker whose SDK is a stand-in that makes bytes from each
// object's id, so tests need no network. It runs the library's real worker
// code, served by src/tests/streaming.test.ts.
import {
  serveStreams,
  type StreamScope,
  type ObjectRef,
  type StreamSdk,
} from '../../../stream/worker'

export type FixtureConfig = {
  chunkSize?: number
  failure?: string
  // Connections to fail before one succeeds.
  failConnects?: number
  failAfter?: number
}
export type FixtureStats = {
  calls: { offset: number; length: number }[]
  produced: number
  cancelled: number
  connections: number
  // The kind of each connection, 'shared' or 'app'.
  kinds: string[]
  freed: number
}

const scope = globalThis as unknown as StreamScope
const stats: FixtureStats = {
  calls: [],
  produced: 0,
  cancelled: 0,
  connections: 0,
  kinds: [],
  freed: 0,
}
const config: FixtureConfig = { chunkSize: 64 * 1024 }

// Fixture-only RPC. No fixture code or routes are included in the app build.
scope.addEventListener('message', (event) => {
  const data = event.data as { type?: string; config?: FixtureConfig } | null
  if (data?.type !== 'fixture-stats') return
  Object.assign(config, data.config)
  event.ports[0]?.postMessage(stats)
})

function wavHeader() {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const text = (offset: number, value: string) =>
    header.set(new TextEncoder().encode(value), offset)
  const dataSize = 600 * 48_000 * 4
  text(0, 'RIFF')
  view.setUint32(4, dataSize + 36, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, 48_000, true)
  view.setUint32(28, 48_000 * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataSize, true)
  return header
}

type MockObject = { id(): string; size(): number; free(): void }

serveStreams(
  scope,
  async (connection) => {
  stats.connections++
  stats.kinds.push(connection.kind)
  // The bridge's stand-in Sdk exports a key of 32 sevens.
  if (connection.kind === 'app' && connection.appKey !== '07'.repeat(32)) {
    throw new Error('Unexpected app key')
  }
  if (config.failConnects) {
    config.failConnects--
    throw new Error('Indexer unreachable')
  }
  return {
    async object({ objectId, sealed }: ObjectRef): Promise<MockObject> {
      // An Sdk's objects arrive sealed. The bridge's stand-in seal is the id.
      const id =
        connection.kind === 'app'
          ? (sealed as unknown as { id: string }).id
          : objectId
      const size = Number(id.split(':')[1])
      if (!Number.isSafeInteger(size)) throw new Error('Unknown fixture object')
      return { id: () => id, size: () => size, free() {} }
    },
    download(object: MockObject, range: { offset: number; length: number }) {
      if (config.failure) throw new Error(config.failure)
      stats.calls.push({ offset: range.offset, length: range.length })
      let position = range.offset
      let remaining = range.length
      let cancelled = false
      const wav = object.id().startsWith('wav:')
      const header = wavHeader()
      return new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            if (!remaining) {
              controller.close()
              return
            }
            // Ten minutes of PCM cannot finish buffering before a seek.
            if (wav) await new Promise((resolve) => setTimeout(resolve, 10))
            if (cancelled) return
            if (
              config.failAfter !== undefined &&
              position >= config.failAfter
            ) {
              throw new Error('Host disconnected during download')
            }
            const length = Math.min(config.chunkSize!, remaining)
            const bytes = Uint8Array.from({ length }, (_, i) =>
              wav ? (header[position + i] ?? 0) : (position + i) % 251,
            )
            position += length
            remaining -= length
            stats.produced += length
            controller.enqueue(bytes)
          },
          cancel() {
            cancelled = true
            stats.cancelled++
          },
        },
        { highWaterMark: 0 },
      )
    },
    free() {
      stats.freed++
    },
  } as unknown as StreamSdk
  },
  true,
)
