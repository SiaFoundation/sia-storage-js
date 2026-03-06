import { loadNativeAddon } from './load'

/**
 * Load the native addon eagerly so missing-binary errors surface immediately.
 */
export async function initSia(): Promise<void> {
  loadNativeAddon()
}

export function generateRecoveryPhrase(): string {
  return loadNativeAddon().generateRecoveryPhrase()
}

export function validateRecoveryPhrase(phrase: string): void {
  loadNativeAddon().validateRecoveryPhrase(phrase)
}

export function setLogLevel(level: string): void {
  loadNativeAddon().setLogLevel(level)
}
