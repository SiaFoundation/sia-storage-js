/**
 * The worker side of streaming, for sites that already run a service worker.
 *
 * A page has only one service worker, so a site with its own calls
 * `installStreams(self)` in it and passes that worker's URL to
 * `enableStreaming`. Every other site serves the prebuilt `sia-storage-sw.js`,
 * which is this function with the WebAssembly built in.
 */
import wasmInit, {
  AppKey,
  Builder,
  type InitInput,
  PinnedObject,
  SharedSdk,
} from '../wasm/sia_storage_wasm.js'
import type { Connection } from './stream/protocol'
import { serveStreams, type StreamScope, type StreamSdk } from './stream/worker'

export type { StreamScope }

export type InstallStreamsOptions = {
  /**
   * The SDK's WebAssembly, as a URL, bytes or compiled module. Only needed
   * when the worker's bundler does not emit `sia_storage_wasm_bg.wasm`.
   */
  wasm?: InitInput
}

export function installStreams(
  scope: StreamScope,
  options: InstallStreamsOptions = {},
) {
  let ready: Promise<unknown> | undefined
  serveStreams(
    scope,
    async (connection) => {
      ready ??= wasmInit(
        options.wasm === undefined ? undefined : { module_or_path: options.wasm },
      )
      await ready
      return connection.kind === 'shared'
        ? connectShared(connection)
        : connectApp(connection)
    },
    // Downloads from hosts need WebTransport, which some browsers leave out
    // of service workers. The page then reads objects itself.
    typeof WebTransport === 'function',
  )
}

async function connectShared({
  indexerUrl,
  seed,
}: Extract<Connection, { kind: 'shared' }>): Promise<StreamSdk> {
  const sdk = await SharedSdk.connect(indexerUrl, seed)
  return {
    object: ({ objectId }) => sdk.object(objectId),
    download: (object, range) => sdk.download(object, range),
    free: () => sdk.free(),
  }
}

async function connectApp({
  indexerUrl,
  appKey,
  appMeta,
}: Extract<Connection, { kind: 'app' }>): Promise<StreamSdk> {
  const key = new AppKey(fromHex(appKey))
  const builder = new Builder(indexerUrl, appMeta)
  try {
    const sdk = await builder.connected(key)
    if (!sdk) throw new Error('The app key is not registered with the indexer.')
    return {
      // The page sent the object sealed with this key, so no lookup is needed.
      object: async ({ sealed }) => PinnedObject.open(key, sealed!),
      download: (object, range) => sdk.download(object, range),
      free: () => {
        sdk.free()
        key.free()
      },
    }
  } catch (error) {
    key.free()
    throw error
  } finally {
    builder.free()
  }
}

// Uint8Array.fromHex is too new for some browsers that run service workers.
function fromHex(hex: string) {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16))
}
