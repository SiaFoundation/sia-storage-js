// Browser entry; lazily initializes WASM on first use.

import wasmInit from '../wasm/sia_storage_wasm.js'

export { detectPrivateRelay } from './relay'
export { enableStreaming, openStreams } from './stream/page'
export type {
  AppCredentials,
  CredentialsFor,
  FileEvents,
  FileOptions,
  SharedCredentials,
  StreamedFile,
  StreamStatus,
  Streams,
  StreamingOptions,
} from './stream/page'

let initPromise: Promise<unknown> | null = null

/** Initialize the WASM module. Safe to call multiple times. */
export async function initSia(): Promise<void> {
  if (!initPromise) initPromise = wasmInit()
  await initPromise
}

export {
  AppKey,
  Builder,
  KeyRecord,
  ObjectEvent,
  PackedUpload,
  PinnedObject,
  Sdk,
  SharedSdk,
  SharingKey,
  encodedSize,
  generateRecoveryPhrase,
  setLogger,
  validateRecoveryPhrase,
} from '../wasm/sia_storage_wasm.js'
export type {
  Account,
  AppMetadata,
  DownloadOptions,
  Host,
  HostQuery,
  KeyStats,
  PinnedSlab,
  Sector,
  SealedObject,
  ShardProgress,
  Slab,
  UploadOptions,
} from '../wasm/sia_storage_wasm.js'
