// Browser smoke: prove WASM loads and the SDK actually runs when bundled
// by a real Vite build. Exercises the same surface as the Node smoke,
// using the WASM-variant AppMetadata shape.
import {
  AppKey,
  Builder,
  generateRecoveryPhrase,
  initSia,
  validateRecoveryPhrase,
} from 'sia-storage'

try {
  await initSia()

  const phrase = generateRecoveryPhrase()
  validateRecoveryPhrase(phrase)

  const seed = new Uint8Array(32).fill(7)
  const key = new AppKey(seed)
  if (key.export().length !== 32) throw new Error('AppKey.export wrong length')

  const msg = new Uint8Array([1, 2, 3])
  const sig = key.sign(msg)
  if (!key.verifySignature(msg, sig)) throw new Error('AppKey sign/verify roundtrip failed')

  new Builder('https://example.com', {
    appId: '0'.repeat(64),
    name: 'test',
    description: 'test',
    serviceUrl: 'https://example.com',
  })

  window.__smoke = { ok: true }
} catch (e) {
  window.__smoke = { ok: false, error: e && e.message ? e.message : String(e) }
}
