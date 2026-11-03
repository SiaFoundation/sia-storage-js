/**
 * A packed upload was cancelled, either by an `AbortSignal` or by a direct
 * `packed.cancel()`. Distinct from a network failure: nothing was pinned, and
 * the caller can start the same files again.
 */
export class UploadCancelled extends Error {
  constructor(message = 'the upload was cancelled') {
    super(message)
    this.name = 'UploadCancelled'
  }
}

/** What [finalizePacked] needs, so both the wasm and the native binding fit. */
export type CancelablePacked<T> = {
  finalize(): Promise<T[]>
  cancel(): void
}

const isCancelMessage = (message: string) => /upload closed|upload cancelled/i.test(message)

/**
 * Finalize a packed upload and return its objects, with a way out.
 *
 * Both bindings keep the handle alive through `finalize`, which is what makes
 * `cancel()` work here: the wasm side borrows instead of consuming. Aborting the
 * signal cancels the upload, the core drops it, and in-flight shard tasks are
 * aborted, so hosts are released instead of working on a slab nobody will pin.
 *
 * Resolves with the objects, or rejects with [UploadCancelled]. A real failure is
 * rethrown unchanged, so a caller can tell the two apart.
 */
export async function finalizePacked<T>(
  packed: CancelablePacked<T>,
  options: { signal?: AbortSignal } = {},
): Promise<T[]> {
  const signal = options.signal
  if (signal?.aborted) {
    packed.cancel()
    throw new UploadCancelled()
  }

  const onAbort = () => packed.cancel()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await packed.finalize()
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && isCancelMessage(error.message))) {
      throw new UploadCancelled()
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
