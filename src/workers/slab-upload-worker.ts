// Web Worker for parallel slab uploads.
// Each worker creates its own SDK instance and uploads slabs on demand.

import init, {
  AppKey,
  Builder,
  type SDK,
  setLogLevel,
  UploadOptions,
} from 'sia-wasm'
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

let sdk: SDK | null = null
let maxUploads = 8

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data

  if (type === 'init') {
    const { indexerUrl, keyHex, maxUploads: maxUploadsInit, logLevel } = e.data

    try {
      maxUploads = maxUploadsInit || maxUploads
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

      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: (err as Error).message || String(err),
      })
    }
    return
  }

  if (type === 'upload-slab') {
    const { slabIndex, data, dataKey, streamOffset } = e.data
    if (!sdk) {
      self.postMessage({
        type: 'slab-error',
        slabIndex,
        message: 'Worker not initialized',
      })
      return
    }
    try {
      const dataKeyBytes = new Uint8Array(dataKey)
      const slabData = new Uint8Array(data)

      const opts = new UploadOptions()
      opts.maxInflight = maxUploads
      const slabJson = await sdk.uploadSlab(
        slabData,
        dataKeyBytes,
        streamOffset,
        opts,
        (current: number, total: number) => {
          self.postMessage({
            type: 'shard-progress',
            slabIndex,
            current,
            total,
          })
        },
      )

      self.postMessage({ type: 'slab-uploaded', slabIndex, slabJson })
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
