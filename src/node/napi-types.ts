// Type-only declarations for the sia_storage_napi surface. Runtime bindings
// come directly from the loaded native addon (see client.ts) — these exist
// so consumers get autocomplete and type-checking. They are erased at emit.

export type AppMeta = {
  id: Buffer
  name: string
  description: string
  serviceUrl: string
  logoUrl?: string
  callbackUrl?: string
}

export type UploadOptions = {
  maxInflight?: number
  dataShards?: number
  parityShards?: number
}

export type DownloadOptions = {
  maxInflight?: number
  offset?: bigint
  length?: bigint
}

export type ObjectsCursor = {
  id: string
  after: Date
}

export type NetAddress = {
  protocol: 'SiaMux' | 'Quic'
  address: string
}

export type PinnedSector = {
  root: string
  hostKey: string
}

export type Slab = {
  encryptionKey: Buffer
  minShards: number
  sectors: PinnedSector[]
  offset: number
  length: number
}

export type PinnedSlab = {
  id: string
  encryptionKey: Buffer
  minShards: number
  sectors: PinnedSector[]
}

export type SealedObject = {
  id: string
  encryptedDataKey: Buffer
  encryptedMetadataKey: Buffer
  slabs: Slab[]
  encryptedMetadata: Buffer
  dataSignature: Buffer
  metadataSignature: Buffer
  createdAt: Date
  updatedAt: Date
}

export type Host = {
  publicKey: string
  addresses: NetAddress[]
  countryCode: string
  latitude: number
  longitude: number
  goodForUpload: boolean
}

export type App = {
  id: string
  name: string
  description: string
  serviceUrl?: string
  logoUrl?: string
}

export type Account = {
  accountKey: string
  maxPinnedData: bigint
  remainingStorage: bigint
  pinnedData: bigint
  pinnedSize: bigint
  ready: boolean
  app: App
  lastUsed: Date
}

export type ProgressFn = (uploaded: number, encodedSize: number) => void

export declare class AppKey {
  constructor(seed: Uint8Array)
  export(): Buffer
  publicKey(): string
  sign(message: Uint8Array): Buffer
  verifySignature(message: Uint8Array, signature: Uint8Array): boolean
}

export declare class PinnedObject {
  constructor()
  static open(appKey: AppKey, sealed: SealedObject): PinnedObject
  seal(appKey: AppKey): SealedObject
  id(): string
  size(): bigint
  encodedSize(): bigint
  slabs(): Slab[]
  metadata(): Buffer
  updateMetadata(metadata: Uint8Array): void
  createdAt(): Date
  updatedAt(): Date
}

export declare class ObjectEvent {
  readonly id: string
  readonly deleted: boolean
  readonly updatedAt: Date
  readonly object: PinnedObject | null
}

export declare class PackedUpload {
  remaining(): bigint
  length(): bigint
  slabs(): bigint
  add(stream: ReadableStream): Promise<bigint>
  cancel(): Promise<void>
  finalize(): Promise<PinnedObject[]>
}

export declare class Sdk {
  appKey(): AppKey
  uploadPacked(
    options: UploadOptions,
    progressFn?: ProgressFn,
  ): Promise<PackedUpload>
  upload(
    object: PinnedObject,
    stream: ReadableStream,
    options: UploadOptions,
    progressFn?: ProgressFn,
  ): Promise<PinnedObject>
  download(object: PinnedObject, options: DownloadOptions): ReadableStream
  hosts(): Promise<Host[]>
  objectEvents(
    cursor: ObjectsCursor | undefined,
    limit: number,
  ): Promise<ObjectEvent[]>
  updateObjectMetadata(object: PinnedObject): Promise<void>
  deleteObject(key: string): Promise<void>
  object(key: string): Promise<PinnedObject>
  slab(slabId: string): Promise<PinnedSlab>
  pruneSlabs(): Promise<void>
  account(): Promise<Account>
  shareObject(object: PinnedObject, validUntil: Date): string
  sharedObject(sharedUrl: string): Promise<PinnedObject>
  pinObject(object: PinnedObject): Promise<void>
}

export declare class Builder {
  constructor(indexerUrl: string, appMeta: AppMeta)
  requestConnection(): Promise<void>
  responseUrl(): string
  waitForApproval(): Promise<void>
  connected(appKey: AppKey): Promise<Sdk | null>
  register(mnemonic: string): Promise<Sdk>
}
