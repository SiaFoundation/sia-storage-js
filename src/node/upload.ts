import type { SiaClient } from './client'
import { PinnedObject, UploadOptions } from './client'

export type UploadProgress = {
  phase: 'connecting' | 'uploading' | 'assembling' | 'pinning'
  slabsComplete: number
  slabsTotal: number
  shardsComplete: number
  shardsTotal: number
  hosts?: string[]
}

/** Upload data. Parallelism is handled by tokio in the native addon. */
export async function upload(
  client: SiaClient,
  file: File | Uint8Array | Buffer,
  onProgress: (p: UploadProgress) => void,
): Promise<PinnedObject> {
  const { sdk } = client

  // Convert File to Uint8Array if needed
  let data: Uint8Array
  if (file instanceof File) {
    data = new Uint8Array(await file.arrayBuffer())
  } else {
    data = file instanceof Uint8Array ? file : new Uint8Array(file)
  }

  const opts = new UploadOptions()

  onProgress({
    phase: 'uploading',
    slabsComplete: 0,
    slabsTotal: 0,
    shardsComplete: 0,
    shardsTotal: 0,
  })

  const result = await sdk.upload(data, opts, (current, total) => {
    onProgress({
      phase: 'uploading',
      slabsComplete: 0,
      slabsTotal: 0,
      shardsComplete: current,
      shardsTotal: total,
    })
  })

  onProgress({
    phase: 'assembling',
    slabsComplete: 0,
    slabsTotal: 0,
    shardsComplete: 0,
    shardsTotal: 0,
  })

  return result
}
