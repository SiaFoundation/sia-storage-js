import init, {
  AppKey,
  Builder,
  DownloadOptions,
  generateRecoveryPhrase,
  init_panic_hook,
  PackedUpload as WasmPackedUpload,
  PinnedObject,
  type SDK,
  setLogLevel,
  UploadOptions,
  validateRecoveryPhrase,
} from 'sia-wasm'

let initialized = false

/**
 * Initialize the Sia WASM module. Must be called once before using any other SDK functions.
 * Subsequent calls are no-ops.
 */
export async function initSia(): Promise<void> {
  if (initialized) return
  await init()
  init_panic_hook()
  initialized = true
}

export {
  AppKey,
  Builder,
  DownloadOptions,
  PinnedObject,
  type SDK,
  UploadOptions,
  WasmPackedUpload,
  generateRecoveryPhrase,
  setLogLevel,
  validateRecoveryPhrase,
}
