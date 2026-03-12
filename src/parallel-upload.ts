import type { PinnedObject, SDK } from './wasm/init'
import { UploadOptions } from './wasm/init'

export type UploadProgress = {
  phase: 'connecting' | 'uploading' | 'assembling' | 'pinning'
  slabsComplete: number
  slabsTotal: number
  shardsComplete: number
  shardsTotal: number
  hosts?: string[]
}

/**
 * Upload a file to Sia. Small files (single slab, ~40 MiB) are uploaded
 * directly on the main thread. Larger files use a pool of Web Workers for
 * parallel slab uploads.
 *
 * @internal Called by SiaClient.upload() — not exported directly.
 */
export async function uploadImpl(
  sdk: SDK,
  keyHex: string,
  indexerUrl: string,
  file: File | Uint8Array,
  onProgress: (p: UploadProgress) => void,
  numWorkers = 4,
): Promise<PinnedObject> {
  const fileSize = file instanceof File ? file.size : file.byteLength
  const SLAB_DATA_SIZE = sdk.slabDataSize()
  const slabCount = fileSize === 0 ? 0 : Math.ceil(fileSize / SLAB_DATA_SIZE)

  // Small files: upload directly on the main thread without workers
  if (slabCount <= 1) {
    const data =
      file instanceof File
        ? new Uint8Array(await file.arrayBuffer())
        : file

    onProgress({
      phase: 'uploading',
      slabsComplete: 0,
      slabsTotal: slabCount,
      shardsComplete: 0,
      shardsTotal: slabCount * 30,
    })

    const opts = new UploadOptions()
    opts.maxInflight = 8
    const obj = await sdk.upload(data, opts, (current: number, total: number) => {
      onProgress({
        phase: 'uploading',
        slabsComplete: 0,
        slabsTotal: slabCount,
        shardsComplete: current,
        shardsTotal: total,
      })
    })

    onProgress({
      phase: 'assembling',
      slabsComplete: slabCount,
      slabsTotal: slabCount,
      shardsComplete: slabCount * 30,
      shardsTotal: slabCount * 30,
    })

    return obj
  }

  // Large files: worker pool for parallel slab uploads
  const dataKey = sdk.generateDataKey()
  const dataKeyBuf = dataKey.buffer.slice(
    dataKey.byteOffset,
    dataKey.byteOffset + dataKey.byteLength,
  )

  // Cap workers at slab count
  const actualWorkers = Math.min(numWorkers, Math.max(slabCount, 1))

  onProgress({
    phase: 'connecting',
    slabsComplete: 0,
    slabsTotal: slabCount,
    shardsComplete: 0,
    shardsTotal: slabCount * 30,
  })

  // Spawn worker pool
  const workers: Worker[] = []
  const readyPromises: Promise<void>[] = []

  for (let i = 0; i < actualWorkers; i++) {
    const w = new Worker(
      new URL('./workers/slab-upload-worker.ts', import.meta.url),
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
      maxUploads: 8,
      workerIndex: i,
      numWorkers: actualWorkers,
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
  const slabJsons = new Array<string>(slabCount)
  const slabShards = new Array<number>(slabCount).fill(0)
  let nextSlab = 0
  let completedSlabs = 0

  onProgress({
    phase: 'uploading',
    slabsComplete: 0,
    slabsTotal: slabCount,
    shardsComplete: 0,
    shardsTotal: slabCount * 30,
  })

  return new Promise<PinnedObject>((resolve, reject) => {
    let rejected = false

    function sendSlabToWorker(worker: Worker, idx: number) {
      const slabOffset = idx * SLAB_DATA_SIZE
      const slabEnd = Math.min(slabOffset + SLAB_DATA_SIZE, fileSize)
      if (file instanceof File) {
        const blob = file.slice(slabOffset, slabEnd)
        blob.arrayBuffer().then((buf) => {
          worker.postMessage(
            {
              type: 'upload-slab',
              slabIndex: idx,
              data: buf,
              dataKey: dataKeyBuf,
              streamOffset: slabOffset,
            },
            [buf],
          )
        })
      } else {
        const buf = file.buffer.slice(
          file.byteOffset + slabOffset,
          file.byteOffset + slabEnd,
        )
        worker.postMessage(
          {
            type: 'upload-slab',
            slabIndex: idx,
            data: buf,
            dataKey: dataKeyBuf,
            streamOffset: slabOffset,
          },
          [buf],
        )
      }
    }

    function assignWork(worker: Worker) {
      if (nextSlab >= slabCount || rejected) return
      const idx = nextSlab++
      sendSlabToWorker(worker, idx)
    }

    for (const w of workers) {
      w.onmessage = (e: MessageEvent) => {
        if (rejected) return

        if (e.data.type === 'shard-progress') {
          slabShards[e.data.slabIndex] = e.data.current
          const shardsComplete = slabShards.reduce((a, b) => a + b, 0)
          onProgress({
            phase: 'uploading',
            slabsComplete: completedSlabs,
            slabsTotal: slabCount,
            shardsComplete,
            shardsTotal: slabCount * 30,
          })
        }

        if (e.data.type === 'slab-uploaded') {
          slabJsons[e.data.slabIndex] = e.data.slabJson
          completedSlabs++

          if (completedSlabs === slabCount) {
            for (const w of workers) w.terminate()

            onProgress({
              phase: 'assembling',
              slabsComplete: slabCount,
              slabsTotal: slabCount,
              shardsComplete: slabCount * 30,
              shardsTotal: slabCount * 30,
            })

            try {
              const combinedSlabs = `[${slabJsons.join(',')}]`
              const obj = sdk.assembleObject(dataKey, combinedSlabs)

              const slabInfos = obj.slabs()
              const allHosts = new Set<string>()
              for (const slab of slabInfos) {
                for (const key of slab.hostKeys) allHosts.add(key)
              }
              onProgress({
                phase: 'assembling',
                slabsComplete: slabCount,
                slabsTotal: slabCount,
                shardsComplete: slabCount * 30,
                shardsTotal: slabCount * 30,
                hosts: [...allHosts],
              })

              resolve(obj)
            } catch (err) {
              reject(err)
            }
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
