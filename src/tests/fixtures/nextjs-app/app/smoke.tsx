'use client'
import { useEffect, useState } from 'react'
import {
  AppKey,
  Builder,
  generateRecoveryPhrase,
  initSia,
  type PackedUpload,
  validateRecoveryPhrase,
} from '@siafoundation/sia-storage'

// Type-level assertion: under the browser/default condition the package's
// WASM .d.ts must resolve, so PackedUpload.length() returns `number`, not
// `bigint`. This function is never called — its body exists only so `next build`
// runs tsc over it. If the NAPI types ever leak into bundler resolution, the
// build fails with TS2365.
function _typeProbe(u: PackedUpload): number {
  return u.length() + u.remaining() + 1
}
void _typeProbe

declare global {
  interface Window {
    __smoke?: { ok: boolean; error?: string }
  }
}

export default function Smoke() {
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    ;(async () => {
      try {
        await initSia()
        const phrase = generateRecoveryPhrase()
        validateRecoveryPhrase(phrase)
        const seed = new Uint8Array(32).fill(7)
        const key = new AppKey(seed)
        if (key.export().length !== 32) throw new Error('AppKey.export wrong length')
        const msg = new Uint8Array([1, 2, 3])
        const sig = key.sign(msg)
        if (!key.verifySignature(msg, sig)) throw new Error('sign/verify failed')
        new Builder('https://example.com', {
          appId: '0'.repeat(64),
          name: 'test',
          description: 'test',
          serviceUrl: 'https://example.com',
          logoUrl: undefined,
          callbackUrl: undefined,
        })
        window.__smoke = { ok: true }
        setStatus('done')
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e)
        window.__smoke = { ok: false, error }
        setStatus(`error: ${error}`)
      }
    })()
  }, [])

  return <div>status: {status}</div>
}
