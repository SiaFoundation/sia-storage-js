export { SiaClient, connect } from './wasm/client'
export { decodeMetadata } from './format'
export { fromHex, toHex } from './hex'
export {
  AppKey,
  Builder,
  DownloadOptions,
  generateRecoveryPhrase,
  initSia,
  PinnedObject,
  type SDK,
  type SlabInfo,
  setLogLevel,
  UploadOptions,
  validateRecoveryPhrase,
} from './wasm/init'
export type { DownloadConfig, DownloadProgress } from './parallel-download'
export { download } from './parallel-download'
export type { UploadProgress } from './parallel-upload'
export { upload } from './parallel-upload'
