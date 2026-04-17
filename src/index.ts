// Browser entry. Loads the sia_storage_wasm glue lazily on first use so
// consumers don't pay the init cost at import time and bundlers can still
// route the .wasm asset through their own pipelines.

import wasmInit from '../wasm/sia_storage_wasm.js'

let initPromise: Promise<unknown> | null = null

/**
 * Initialize the WASM module. Safe to call multiple times — subsequent
 * calls return the same promise. All SDK classes and free functions assume
 * this has resolved before use; call `await initSia()` once at app startup
 * or before the first SDK interaction.
 */
export async function initSia(): Promise<void> {
  if (!initPromise) initPromise = wasmInit()
  await initPromise
}

// Direct re-exports from wasm-bindgen's generated glue. The crate tags
// free functions with js_name so they land as camelCase, matching NAPI.
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

import {
  AppKey as AppKeyCls,
  Builder as BuilderCls,
  Sdk as SdkCls,
  setLogLevel as setLogLevelFn,
} from '../wasm/sia_storage_wasm.js'
import type { AppMetadata } from '../wasm/sia_storage_wasm.js'

// Browser has no logger-callback equivalent yet. Forward the level and
// silently ignore the callback so code written against the Node surface
// still type-checks and runs. Log messages go to console.log via the
// crate's built-in console logger.
export function setLogger(
  _callback: (message: string) => void,
  level: string,
): void {
  setLogLevelFn(level)
}

export async function connect(
  indexerUrl: string,
  appMeta: AppMetadata,
  appKey: AppKeyCls,
): Promise<SdkCls | undefined> {
  await initSia()
  const builder = new BuilderCls(indexerUrl, appMeta)
  return builder.connected(appKey)
}
