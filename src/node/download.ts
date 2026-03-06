import type { SiaClient } from './client'
import type { PinnedObject } from './client'
import { DownloadOptions } from './client'

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

/** Download an object. Parallelism is handled by tokio in the native addon. */
export async function download(
  client: SiaClient,
  object: PinnedObject,
  onProgress?: (p: DownloadProgress) => void,
  config?: DownloadConfig,
): Promise<Uint8Array> {
  const { sdk } = client
  const { maxInflight = 10 } = config ?? {}

  const totalBytes = object.size()

  onProgress?.({
    phase: 'downloading',
    slabsComplete: 0,
    slabsTotal: object.slabCount(),
    bytesComplete: 0,
    bytesTotal: totalBytes,
  })

  const opts = new DownloadOptions()
  opts.maxInflight = maxInflight

  let data: Uint8Array

  if (config?.range) {
    const { offset, length } = config.range
    data = await sdk.downloadRange(
      object,
      offset,
      length,
      opts,
      (hostKey) => {
        onProgress?.({
          phase: 'downloading',
          slabsComplete: 0,
          slabsTotal: object.slabCount(),
          bytesComplete: 0,
          bytesTotal: length,
          hostKey,
        })
      },
    )
  } else {
    data = await sdk.download(object, opts, (current, total) => {
      onProgress?.({
        phase: 'downloading',
        slabsComplete: current,
        slabsTotal: total,
        bytesComplete: 0,
        bytesTotal: totalBytes,
      })
    })
  }

  onProgress?.({
    phase: 'assembling',
    slabsComplete: object.slabCount(),
    slabsTotal: object.slabCount(),
    bytesComplete: config?.range?.length ?? totalBytes,
    bytesTotal: config?.range?.length ?? totalBytes,
  })

  return data
}
