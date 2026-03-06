import type { SiaClient } from './wasm/client'
import type { PinnedObject } from './wasm/init'
import { DownloadOptions } from './wasm/init'

export type DownloadProgress = {
  phase: 'connecting' | 'downloading' | 'assembling'
  slabsComplete: number
  slabsTotal: number
  bytesComplete: number
  bytesTotal: number
  hostKey?: string
}

export type DownloadConfig = {
  workers?: number
  range?: { offset: number; length: number }
  maxInflight?: number
}

/**
 * Download an object from Sia using a pool of Web Workers for parallel slab retrieval.
 * Supports full downloads and byte-range requests via {@link DownloadConfig.range}.
 */
export async function download(
  client: SiaClient,
  object: PinnedObject,
  onProgress?: (p: DownloadProgress) => void,
  config?: DownloadConfig,
): Promise<Uint8Array> {
  const { sdk, keyHex, indexerUrl } = client
  const { range, maxInflight = 10 } = config ?? {}

  // Range download: runs on main thread, no workers needed
  if (range) {
    const opts = new DownloadOptions()
    opts.maxInflight = maxInflight

    onProgress?.({
      phase: 'downloading',
      slabsComplete: 0,
      slabsTotal: 0,
      bytesComplete: 0,
      bytesTotal: range.length,
    })

    const data = await sdk.downloadRange(
      object,
      range.offset,
      range.length,
      opts,
      (hostKey: string) => {
        onProgress?.({
          phase: 'downloading',
          slabsComplete: 0,
          slabsTotal: 0,
          bytesComplete: 0,
          bytesTotal: range.length,
          hostKey,
        })
      },
    )

    onProgress?.({
      phase: 'assembling',
      slabsComplete: 0,
      slabsTotal: 0,
      bytesComplete: range.length,
      bytesTotal: range.length,
    })

    return data
  }

  // Full download: worker pool
  const numWorkers = config?.workers ?? 4
  const slabCount = object.slabCount()
  const slabLengths: number[] = object.slabLengths()
  const totalBytes = slabLengths.reduce((a, b) => a + b, 0)

  // Cap workers at slab count
  const actualWorkers = Math.min(numWorkers, Math.max(slabCount, 1))

  onProgress?.({
    phase: 'connecting',
    slabsComplete: 0,
    slabsTotal: slabCount,
    bytesComplete: 0,
    bytesTotal: totalBytes,
  })

  // Seal the object for transfer to workers
  const appKey = sdk.appKey()
  const sealedObjectJson = object.seal(appKey)

  // Spawn worker pool
  const workers: Worker[] = []
  const readyPromises: Promise<void>[] = []

  for (let i = 0; i < actualWorkers; i++) {
    const w = new Worker(
      new URL('./workers/slab-download-worker.ts', import.meta.url),
      { type: 'module' },
    )
    const ready = new Promise<void>((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          w.removeEventListener('message', handler)
          resolve()
        }
        if (e.data.type === 'error') {
          w.removeEventListener('message', handler)
          reject(new Error(e.data.message))
        }
      }
      w.addEventListener('message', handler)
    })
    w.postMessage({
      type: 'init',
      indexerUrl,
      keyHex,
      maxDownloads: maxInflight,
      sealedObjectJson,
    })
    workers.push(w)
    readyPromises.push(ready)
  }

  try {
    await Promise.all(readyPromises)
  } catch (err) {
    for (const w of workers) w.terminate()
    throw err
  }

  // Assign slabs to workers round-robin and collect results
  const slabBuffers = new Array<Uint8Array>(slabCount)
  let nextSlab = 0
  let completedSlabs = 0
  let bytesComplete = 0

  onProgress?.({
    phase: 'downloading',
    slabsComplete: 0,
    slabsTotal: slabCount,
    bytesComplete: 0,
    bytesTotal: totalBytes,
  })

  return new Promise<Uint8Array>((resolve, reject) => {
    let rejected = false

    function assignWork(worker: Worker) {
      if (nextSlab >= slabCount || rejected) return
      const idx = nextSlab++
      worker.postMessage({ type: 'download-slab', slabIndex: idx })
    }

    for (const w of workers) {
      w.onmessage = (e: MessageEvent) => {
        if (rejected) return

        if (e.data.type === 'sector-downloaded') {
          onProgress?.({
            phase: 'downloading',
            slabsComplete: completedSlabs,
            slabsTotal: slabCount,
            bytesComplete,
            bytesTotal: totalBytes,
            hostKey: e.data.hostKey,
          })
        }

        if (e.data.type === 'slab-downloaded') {
          const slabData = new Uint8Array(e.data.data)
          slabBuffers[e.data.slabIndex] = slabData
          completedSlabs++
          bytesComplete += slabData.byteLength

          onProgress?.({
            phase: 'downloading',
            slabsComplete: completedSlabs,
            slabsTotal: slabCount,
            bytesComplete,
            bytesTotal: totalBytes,
          })

          if (completedSlabs === slabCount) {
            for (const w of workers) w.terminate()

            onProgress?.({
              phase: 'assembling',
              slabsComplete: slabCount,
              slabsTotal: slabCount,
              bytesComplete: totalBytes,
              bytesTotal: totalBytes,
            })

            // Assemble all slabs into a single buffer
            const result = new Uint8Array(totalBytes)
            let offset = 0
            for (let i = 0; i < slabCount; i++) {
              result.set(slabBuffers[i], offset)
              offset += slabBuffers[i].byteLength
            }
            resolve(result)
          } else {
            assignWork(w)
          }
        }

        if (e.data.type === 'slab-error') {
          rejected = true
          for (const w of workers) w.terminate()
          reject(new Error(`Slab ${e.data.slabIndex}: ${e.data.message}`))
        }
      }
      assignWork(w)
    }
  })
}
