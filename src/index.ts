export { Builder, SiaClient, connect } from './wasm/client'
export { decodeMetadata } from './format'
export { fromHex, toHex } from './hex'
export {
  AppKey,
  PinnedObject,
  type SlabInfo,
  generateRecoveryPhrase,
  initSia,
  setLogLevel,
  validateRecoveryPhrase,
} from './wasm/init'
export type { DownloadConfig, DownloadProgress } from './parallel-download'
export type { UploadProgress } from './parallel-upload'
