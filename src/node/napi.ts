import { loadNativeAddon } from './load'
import type { AppKey, AppMetadata, Sdk } from './napi.generated'

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

/**
 * Force-load the native addon. Safe to call multiple times; subsequent calls
 * are no-ops. Call once at startup to surface missing-binary errors
 * immediately rather than at first API use.
 */
export async function initSia(): Promise<void> {
  loadNativeAddon()
}

export async function connect(
  indexerUrl: string,
  appMeta: AppMetadata,
  appKey: AppKey,
): Promise<Sdk | null> {
  return new Builder(indexerUrl, appMeta).connected(appKey)
}
