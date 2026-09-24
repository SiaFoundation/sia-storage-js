/**
 * Previews and downloads for pages that cannot stream through the service
 * worker, where the page reads the object itself. A preview holds the whole
 * file in memory as a Blob. A download writes straight to disk through the
 * save picker where the browser has one, and buffers a Blob where it does not.
 */
import type { PinnedObject, Sdk, SharedSdk } from '../../wasm/sia_storage_wasm.js'

type AnySdk = Pick<Sdk | SharedSdk, 'download'>

type Chunk = Uint8Array<ArrayBuffer>

// The File System Access save picker, in Chromium only and not yet in
// TypeScript's DOM types.
type SavePicker = (options: {
  suggestedName: string
}) => Promise<FileSystemFileHandle & { createWritable(): Promise<WritableStream<Chunk>> }>

function chunks(stream: ReadableStream): ReadableStreamDefaultReader<Chunk> {
  return stream.getReader() as ReadableStreamDefaultReader<Chunk>
}

/** The whole object as a Blob, stopping early when `signal` aborts. */
export async function readBlob(
  sdk: AnySdk,
  object: PinnedObject,
  type: string | undefined,
  onProgress: (bytesDownloaded: number) => void,
  signal: AbortSignal,
) {
  const reader = chunks(sdk.download(object))
  const onAbort = () => void reader.cancel()
  signal.addEventListener('abort', onAbort)
  const parts: Chunk[] = []
  let bytesDownloaded = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      bytesDownloaded += value.length
      onProgress(bytesDownloaded)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  signal.throwIfAborted()
  return new Blob(parts, type ? { type } : {})
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Some browsers cancel the download if the URL goes away in the same task.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** False if the visitor closes the save picker. */
export async function saveToDisk(
  sdk: AnySdk,
  object: PinnedObject,
  name: string,
  type: string | undefined,
  onProgress: (bytesDownloaded: number) => void,
) {
  const picker = (window as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker
  if (!picker) {
    const blob = await readBlob(
      sdk,
      object,
      type,
      onProgress,
      new AbortController().signal,
    )
    saveBlob(blob, name)
    return true
  }

  // The picker must open inside the click that asked for it, so nothing is
  // awaited before this call.
  let handle: Awaited<ReturnType<SavePicker>>
  try {
    handle = await picker.call(window, { suggestedName: name })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false
    throw e
  }
  let bytesDownloaded = 0
  const progress = new TransformStream<Chunk, Chunk>({
    transform(chunk, controller) {
      bytesDownloaded += chunk.length
      onProgress(bytesDownloaded)
      controller.enqueue(chunk)
    },
  })
  const file = await handle.createWritable()
  await (sdk.download(object) as ReadableStream<Chunk>)
    .pipeThrough(progress)
    .pipeTo(file)
  return true
}
