import { loadNativeAddon } from './load'

const addon = loadNativeAddon()

export const {
  AppKey,
  Builder,
  Sdk,
  PinnedObject,
  PackedUpload,
  ObjectEvent,
  generateRecoveryPhrase,
  validateRecoveryPhrase,
  setLogger,
  encodedSize,
} = addon

export type * from './napi.generated'

/** Force-load the native addon to surface missing-binary errors at startup. */
export async function initSia(): Promise<void> {
  loadNativeAddon()
}
