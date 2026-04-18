// Browser entry; lazily initializes WASM on first use.

import wasmInit, { setLogLevel } from '../wasm/sia_storage_wasm.js'

let initPromise: Promise<unknown> | null = null

/** Initialize the WASM module. Safe to call multiple times. */
export async function initSia(): Promise<void> {
  if (!initPromise) initPromise = wasmInit()
  await initPromise
}

export {
  AppKey,
  Builder,
  ObjectEvent,
  PackedUpload,
  PinnedObject,
  Sdk,
  encodedSize,
  generateRecoveryPhrase,
  setLogLevel,
  validateRecoveryPhrase,
} from '../wasm/sia_storage_wasm.js'
export type {
  Account,
  AppMetadata,
  DownloadOptions,
  Host,
  HostQuery,
  PinnedSlab,
  Sector,
  SealedObject,
  ShardProgress,
  Slab,
  UploadOptions,
} from '../wasm/sia_storage_wasm.js'

// Browser has no logger callback; forward the level to the console logger.
export function setLogger(
  _callback: (message: string) => void,
  level: string,
): void {
  setLogLevel(level)
}
