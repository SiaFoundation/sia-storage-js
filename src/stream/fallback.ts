/**
 * Previews and downloads for pages that cannot stream through the service
 * worker, where the page reads the object itself. A preview holds the whole
 * file in memory as a Blob. A download writes straight to disk through the
 * save picker where the browser has one, and buffers a Blob where it does not.
 */
import type {
  PinnedObject,
  Sdk,
  SharedSdk,
  ShardProgress,
} from '../../wasm/sia_storage_wasm.js'
import type { StreamStatus } from './protocol'

/** What a file reports while it downloads, on the worker or in the page. */
export type FileEvents = {
  /**
   * Total bytes this URL has received. It is a transfer count, not how much of
   * the file is held: a range read again after a seek counts again, so it can
   * pass the file size, and a new URL for the same file starts from zero. For
   * how much of a video is buffered, read the media element's `buffered`.
   */
  onProgress?: (bytesDownloaded: number) => void
  /**
   * One call per piece the SDK read from a host. A download reads each slab in
   * chunks, so the same slab and shard come again for every chunk, and only
   * the first `minShards` hosts to answer for a chunk are reported.
   */
  onShard?: (progress: ShardProgress) => void
  /** Each change of what the URL is doing. See `StreamStatus`. */
  onStatus?: (status: StreamStatus) => void
}

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

/**
 * Calls an app's callback. One that throws is reported to the console rather
 * than ending the download or skipping the callbacks after it.
 */
export function notify<T>(callback: ((value: T) => void) | undefined, value: T) {
  if (!callback) return
  try {
    callback(value)
  } catch (error) {
    reportError(error)
  }
}

// Asks the SDK for shard reports only when someone listens for them.
function download(sdk: AnySdk, object: PinnedObject, events: FileEvents) {
  const { onShard } = events
  return sdk.download(
    object,
    onShard
      ? { onShardDownloaded: (shard: ShardProgress) => notify(onShard, shard) }
      : {},
  )
}

// The status cycle the worker reports for a stream URL, for a read in the page.
function track({ onProgress, onStatus }: FileEvents) {
  let received = 0
  let started = false
  notify(onStatus, 'connecting')
  return {
    chunk(length: number) {
      if (!started) notify(onStatus, 'downloading')
      started = true
      received += length
      notify(onProgress, received)
    },
    end() {
      notify(onStatus, 'idle')
    },
  }
}

/** The whole object as a Blob, stopping early when `signal` aborts. */
export async function readBlob(
  sdk: AnySdk,
  object: PinnedObject,
  type: string | undefined,
  events: FileEvents,
  signal: AbortSignal,
) {
  const progress = track(events)
  let reader: ReadableStreamDefaultReader<Chunk> | undefined
  const onAbort = () => void reader?.cancel()
  signal.addEventListener('abort', onAbort)
  const parts: Chunk[] = []
  try {
    // Inside the try, so a download that fails to start still reports idle.
    reader = chunks(download(sdk, object, events))
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      progress.chunk(value.length)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    progress.end()
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
  events: FileEvents,
) {
  const picker = (window as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker
  if (!picker) {
    const blob = await readBlob(
      sdk,
      object,
      type,
      events,
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
  const file = await handle.createWritable()
  const progress = track(events)
  const counter = new TransformStream<Chunk, Chunk>({
    transform(chunk, controller) {
      progress.chunk(chunk.length)
      controller.enqueue(chunk)
    },
  })
  try {
    await (download(sdk, object, events) as ReadableStream<Chunk>)
      .pipeThrough(counter)
      .pipeTo(file)
  } finally {
    progress.end()
  }
  return true
}
