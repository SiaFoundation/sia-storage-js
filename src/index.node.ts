export { SiaClient, connect } from './node/client'
export { decodeMetadata } from './format'

// Utilities
export { fromHex, toHex } from './hex'
export {
  AppKey,
  Builder,
  DownloadOptions,
  PinnedObject,
  type SDK,
  UploadOptions,
} from './node/client'
export {
  generateRecoveryPhrase,
  initSia,
  setLogLevel,
  validateRecoveryPhrase,
} from './node/init'
export type { DownloadConfig, DownloadProgress } from './node/download'
export { download } from './node/download'
export type { UploadProgress } from './node/upload'
export { upload } from './node/upload'
