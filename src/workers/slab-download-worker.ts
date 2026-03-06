// Web Worker for parallel slab downloads.
// Each worker creates its own SDK instance and downloads slabs on demand.

import init, {
  AppKey,
  Builder,
  DownloadOptions,
  PinnedObject,
  type SDK,
  setLogLevel,
} from 'sia-wasm'
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

let sdk: SDK | null = null
let object: PinnedObject | null = null
let maxDownloads = 10

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data

  if (type === 'init') {
    const {
      indexerUrl,
      keyHex,
      maxDownloads: maxDownloadsInit,
      sealedObjectJson,
      logLevel,
    } = e.data

    try {
      maxDownloads = maxDownloadsInit || maxDownloads
      await init()
      if (logLevel) setLogLevel(logLevel)

      const seed = fromHex(keyHex)
      const appKey = new AppKey(seed)
      const builder = new Builder(indexerUrl)

      sdk = await builder.connected(appKey)
      if (!sdk) {
        self.postMessage({
          type: 'error',
          message: 'SDK connection failed — app key not recognized',
        })
        return
      }

      // Reconstruct the PinnedObject from sealed JSON
      object = PinnedObject.open(appKey, sealedObjectJson)

      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: (err as Error).message || String(err),
      })
    }
    return
  }

  if (type === 'download-slab') {
    const { slabIndex } = e.data
    if (!sdk || !object) {
      self.postMessage({
        type: 'slab-error',
        slabIndex,
        message: 'Worker not initialized',
      })
      return
    }
    try {
      const opts = new DownloadOptions()
      opts.maxInflight = maxDownloads
      const data: Uint8Array = await sdk.downloadSlabByIndex(
        object,
        slabIndex,
        opts,
        (hostKey: string) => {
          self.postMessage({ type: 'sector-downloaded', slabIndex, hostKey })
        },
      )

      // Transfer the buffer back to the main thread
      const buffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      )
      self.postMessage({ type: 'slab-downloaded', slabIndex, data: buffer }, [
        buffer,
      ])
    } catch (err) {
      self.postMessage({
        type: 'slab-error',
        slabIndex,
        message: (err as Error).message || String(err),
      })
    }
    return
  }
}
