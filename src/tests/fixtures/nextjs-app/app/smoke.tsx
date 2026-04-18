'use client'
import { useEffect, useState } from 'react'
import {
  AppKey,
  Builder,
  generateRecoveryPhrase,
  initSia,
  validateRecoveryPhrase,
} from 'sia-storage'

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
