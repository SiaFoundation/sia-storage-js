// Node/Bun smoke: prove the installed package imports and runs.
import {
  AppKey,
  generateRecoveryPhrase,
  initSia,
  validateRecoveryPhrase,
} from 'sia-storage'

await initSia()
const phrase = generateRecoveryPhrase()
validateRecoveryPhrase(phrase)
new AppKey(new Uint8Array(32).fill(1)).publicKey()

console.log('ok')
