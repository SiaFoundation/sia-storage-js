import { loadNativeAddon } from './load'
import type * as Types from './napi-types'

// Direct re-export of the sia_storage_napi surface. Runtime comes straight
// from the loaded native addon; types come from the sibling napi-types.ts
// declarations so consumers get autocomplete and type-checking.

const addon = loadNativeAddon()

export const AppKey: typeof Types.AppKey = addon.AppKey
export const Builder: typeof Types.Builder = addon.Builder
export const Sdk: typeof Types.Sdk = addon.Sdk
export const PinnedObject: typeof Types.PinnedObject = addon.PinnedObject
export const PackedUpload: typeof Types.PackedUpload = addon.PackedUpload
export const ObjectEvent: typeof Types.ObjectEvent = addon.ObjectEvent

// Instance-type exports so `let key: AppKey` works alongside `new AppKey(...)`.
export type AppKey = Types.AppKey
export type Builder = Types.Builder
export type Sdk = Types.Sdk
export type PinnedObject = Types.PinnedObject
export type PackedUpload = Types.PackedUpload
export type ObjectEvent = Types.ObjectEvent

export type {
  Account,
  App,
  AppMeta,
  DownloadOptions,
  Host,
  NetAddress,
  ObjectsCursor,
  PinnedSector,
  PinnedSlab,
  ProgressFn,
  SealedObject,
  Slab,
  UploadOptions,
} from './napi-types'

export const generateRecoveryPhrase: () => string = addon.generateRecoveryPhrase
export const validateRecoveryPhrase: (phrase: string) => void =
  addon.validateRecoveryPhrase
export const setLogger: (
  callback: (message: string) => void,
  level: string,
) => void = addon.setLogger
export const encodedSize: (
  size: bigint,
  dataShards: number,
  parityShards: number,
) => bigint = addon.encodedSize

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
  appMeta: Types.AppMeta,
  appKey: Types.AppKey,
): Promise<Types.Sdk | null> {
  const builder = new Builder(indexerUrl, appMeta)
  return builder.connected(appKey)
}
