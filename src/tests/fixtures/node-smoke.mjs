// Node/Bun smoke: prove the installed package imports and actually drives
// the SDK. Exercises the things a consumer does before making any network
// call: initialize, generate & validate a recovery phrase, construct and
// round-trip an AppKey, sign + verify, construct a Builder.
import {
  AppKey,
  Builder,
  generateRecoveryPhrase,
  initSia,
  validateRecoveryPhrase,
} from '@siafoundation/sia-storage'

await initSia()

const phrase = generateRecoveryPhrase()
validateRecoveryPhrase(phrase)

const seed = new Uint8Array(32).fill(7)
const key = new AppKey(seed)
const exported = key.export()
if (exported.length !== 32) throw new Error('AppKey.export wrong length')

const msg = new Uint8Array([1, 2, 3])
const sig = key.sign(msg)
if (!key.verifySignature(msg, sig)) throw new Error('AppKey sign/verify roundtrip failed')

new Builder('https://example.com', {
  id: Buffer.alloc(32),
  name: 'test',
  description: 'test',
  serviceUrl: 'https://example.com',
})

console.log('ok')
