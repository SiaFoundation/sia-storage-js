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

// Runtime + type re-exports straight from wasm-bindgen's generated glue.
// Class names match NAPI; free-function names are snake_case below —
// see README "Node vs browser" for why, and for camelCase aliases.
export {
  AppKey,
  Builder,
  ObjectEvent,
  PackedUpload,
  PinnedObject,
  Sdk,
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
  Slab,
  UploadOptions,
} from '../wasm/sia_storage_wasm.js'

import {
  AppKey as AppKeyCls,
  Builder as BuilderCls,
  Sdk as SdkCls,
  calculate_encoded_size,
  generate_recovery_phrase,
  set_log_level,
  validate_recovery_phrase,
} from '../wasm/sia_storage_wasm.js'
import type { AppMetadata } from '../wasm/sia_storage_wasm.js'

// Upstream WASM currently exports free functions as snake_case. Re-export
// under camelCase to match the Node surface. Remove these when upstream
// SiaFoundation/sia-sdk-rs#334 merges and emits camelCase via js_name.
export const generateRecoveryPhrase: () => string = generate_recovery_phrase
export const validateRecoveryPhrase: (phrase: string) => void =
  validate_recovery_phrase
export const setLogLevel: (level: string) => void = set_log_level
export const encodedSize: (
  size: number,
  dataShards: number,
  parityShards: number,
) => number = calculate_encoded_size

// Browser has no logger-callback equivalent. Forward the level and
// silently ignore the callback so code written against the Node surface
// still type-checks and runs. Log messages go to console.log via the
// crate's built-in console logger.
export function setLogger(
  _callback: (message: string) => void,
  level: string,
): void {
  set_log_level(level)
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
