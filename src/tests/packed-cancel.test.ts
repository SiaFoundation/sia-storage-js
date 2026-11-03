import { describe, expect, test } from 'bun:test'
import { UploadCancelled, finalizePacked, type CancelablePacked } from '../index'

/**
 * A stand-in for a packed upload. It never finishes on its own, exactly like an
 * upload that is waiting on a host, and only settles when it is cancelled.
 */
function stallingUpload() {
  let cancel: () => void = () => undefined
  const packed: CancelablePacked<string> = {
    finalize: () =>
      new Promise<string[]>((resolve, reject) => {
        cancel = () => reject(new Error('upload closed'))
        void resolve
      }),
    cancel: () => cancel(),
  }
  return packed
}

describe('finalizePacked', () => {
  test('aborting cancels the packed upload and reports UploadCancelled', async () => {
    const packed = stallingUpload()
    const controller = new AbortController()
    const pending = finalizePacked(packed, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(UploadCancelled)
  })

  test('an already aborted signal cancels before finalize is called', async () => {
    let finalized = false
    let cancelled = false
    const packed: CancelablePacked<string> = {
      finalize: async () => {
        finalized = true
        return []
      },
      cancel: () => {
        cancelled = true
      },
    }
    const controller = new AbortController()
    controller.abort()
    await expect(finalizePacked(packed, { signal: controller.signal })).rejects.toBeInstanceOf(
      UploadCancelled,
    )
    expect(cancelled).toBe(true)
    expect(finalized).toBe(false)
  })

  test('a real failure is rethrown unchanged, not reported as a cancel', async () => {
    const failure = new Error('no storage host accepted a shard')
    const packed: CancelablePacked<string> = {
      finalize: async () => {
        throw failure
      },
      cancel: () => undefined,
    }
    await expect(finalizePacked(packed)).rejects.toBe(failure)
  })

  test('objects come back untouched when nothing is aborted', async () => {
    const packed: CancelablePacked<string> = {
      finalize: async () => ['a', 'b'],
      cancel: () => undefined,
    }
    expect(await finalizePacked(packed)).toEqual(['a', 'b'])
  })
})
