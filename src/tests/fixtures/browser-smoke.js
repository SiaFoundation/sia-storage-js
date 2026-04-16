// Browser smoke: prove WASM loads and the SDK runs in a real bundler.
import {
  AppKey,
  generateRecoveryPhrase,
  initSia,
  validateRecoveryPhrase,
} from 'sia-storage'

try {
  await initSia()
  const phrase = generateRecoveryPhrase()
  validateRecoveryPhrase(phrase)
  new AppKey(new Uint8Array(32).fill(1)).publicKey()
  window.__smoke = { ok: true }
} catch (e) {
  window.__smoke = { ok: false, error: e && e.message ? e.message : String(e) }
}
