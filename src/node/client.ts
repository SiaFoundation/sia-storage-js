import { loadNativeAddon } from './load'

type NativeAppKey = {
  publicKey(): string
  sign(message: Buffer): Buffer
  verifySignature(message: Buffer, signature: Buffer): boolean
  export(): Buffer
}

type NativeStreamingUpload = {
  pushChunk(data: Buffer | null): Promise<void>
  promise(): Promise<NativePinnedObject>
}

type NativeSDK = {
  appKey(): NativeAppKey
  objectEvents(
    cursorJson: string | null,
    limit: number,
  ): Promise<
    Array<{
      id: string
      deleted: boolean
      updatedAt: number
      object: NativePinnedObject | null
    }>
  >
  object(key: string): Promise<NativePinnedObject>
  upload(
    data: Buffer,
    options: NativeUploadOptions,
    onProgress: (current: number, total: number) => void,
  ): Promise<NativePinnedObject>
  download(
    object: NativePinnedObject,
    options: NativeDownloadOptions,
    onProgress: (current: number, total: number) => void,
    onSector: (hostKey: string) => void,
  ): Promise<Buffer>
  downloadRange(
    object: NativePinnedObject,
    offset: number,
    length: number,
    options: NativeDownloadOptions,
    onSector: (hostKey: string) => void,
  ): Promise<Buffer>
  downloadStreaming(
    object: NativePinnedObject,
    options: NativeDownloadOptions,
    onChunk: (data: Buffer) => void,
    onProgress: (current: number, total: number) => void,
  ): Promise<void>
  downloadSlabByIndex(
    object: NativePinnedObject,
    index: number,
    options: NativeDownloadOptions,
    onSector: (hostKey: string) => void,
  ): Promise<Buffer>
  uploadSlab(
    data: Buffer,
    dataKey: Buffer,
    offset: number,
    options: NativeUploadOptions,
    onProgress: (current: number, total: number) => void,
  ): Promise<string>
  generateDataKey(): Buffer
  assembleObject(dataKey: Buffer, slabsJson: string): NativePinnedObject
  pinObject(object: NativePinnedObject): Promise<void>
  updateObjectMetadata(object: NativePinnedObject): Promise<void>
  deleteObject(key: string): Promise<void>
  sharedObject(url: string): Promise<NativePinnedObject>
  shareObject(object: NativePinnedObject, validUntilMs: number): string
  hosts(): Promise<string>
  account(): Promise<string>
  pruneSlabs(): Promise<void>
  slabDataSize(): number
  startChunkedUpload(totalSize: number): number
  uploadChunk(sessionId: number, chunk: Buffer): number
  finalizeChunkedUpload(
    sessionId: number,
    options: NativeUploadOptions,
    onProgress: (current: number, total: number) => void,
  ): Promise<NativePinnedObject>
  streamingUpload(
    totalSize: number,
    options: NativeUploadOptions,
    onProgress: (current: number, total: number) => void,
  ): NativeStreamingUpload
}

type NativePinnedObject = {
  id(): string
  size(): number
  slabCount(): number
  slabLengths(): number[]
  slabs(): string
  metadata(): Buffer
  updateMetadata(metadata: Buffer): void
  seal(appKey: NativeAppKey): string
  createdAt(): number
  updatedAt(): number
}

type NativeUploadOptions = {
  dataShards?: number
  parityShards?: number
  maxInflight?: number
}

type NativeDownloadOptions = {
  maxInflight?: number
}

type NativeBuilder = {
  requestConnection(appMetaJson: string): Promise<void>
  responseUrl(): string
  waitForApproval(): Promise<void>
  setConnectionResponse(appIdHex: string, responseJson: string): void
  connected(appKey: NativeAppKey): Promise<NativeSDK | null>
  register(mnemonic: string): Promise<NativeSDK>
}

export class PinnedObject {
  /** @internal */
  readonly _native: NativePinnedObject

  /** @internal */
  constructor(native: NativePinnedObject) {
    this._native = native
  }

  id(): string {
    return this._native.id()
  }

  size(): number {
    return this._native.size()
  }

  slabCount(): number {
    return this._native.slabCount()
  }

  slabLengths(): number[] {
    return this._native.slabLengths()
  }

  slabs(): Array<{
    offset: number
    length: number
    minShards: number
    hostKeys: string[]
  }> {
    return JSON.parse(this._native.slabs())
  }

  metadata(): Uint8Array {
    return new Uint8Array(this._native.metadata())
  }

  updateMetadata(metadata: Uint8Array): void {
    this._native.updateMetadata(Buffer.from(metadata))
  }

  seal(appKey: AppKey): string {
    return this._native.seal(appKey._native)
  }

  static open(appKey: AppKey, sealedJson: string): PinnedObject {
    const native = loadNativeAddon().NativePinnedObject.open(
      appKey._native,
      sealedJson,
    )
    return new PinnedObject(native)
  }
}

export class AppKey {
  /** @internal */
  readonly _native: NativeAppKey

  constructor(key: Uint8Array) {
    this._native = new (loadNativeAddon().NativeAppKey)(Buffer.from(key))
  }

  /** @internal - construct from an already-loaded native key */
  static _fromNative(native: NativeAppKey): AppKey {
    const instance = Object.create(AppKey.prototype) as AppKey
    ;(instance as any)._native = native
    return instance
  }

  publicKey(): string {
    return this._native.publicKey()
  }

  sign(message: Uint8Array): Uint8Array {
    return new Uint8Array(this._native.sign(Buffer.from(message)))
  }

  verifySignature(message: Uint8Array, signature: Uint8Array): boolean {
    return this._native.verifySignature(
      Buffer.from(message),
      Buffer.from(signature),
    )
  }

  export(): Uint8Array {
    return new Uint8Array(this._native.export())
  }
}

export class UploadOptions {
  dataShards?: number
  parityShards?: number
  maxInflight: number = 8

  constructor() {}

  /** @internal */
  _toNative(): NativeUploadOptions {
    return {
      dataShards: this.dataShards,
      parityShards: this.parityShards,
      maxInflight: this.maxInflight,
    }
  }

  slabDataSize(): number {
    // Default: 10 data shards * 4 MiB sector size
    return (this.dataShards ?? 10) * 4 * 1024 * 1024
  }
}

export class DownloadOptions {
  maxInflight: number = 10

  constructor() {}

  /** @internal */
  _toNative(): NativeDownloadOptions {
    return {
      maxInflight: this.maxInflight,
    }
  }
}

export type SDK = {
  appKey(): AppKey
  upload(
    data: Uint8Array,
    options: UploadOptions,
    onProgress: (current: number, total: number) => void,
  ): Promise<PinnedObject>
  download(
    object: PinnedObject,
    options: DownloadOptions,
    onProgress: (current: number, total: number) => void,
  ): Promise<Uint8Array>
  downloadRange(
    object: PinnedObject,
    offset: number,
    length: number,
    options: DownloadOptions,
    onSector: (hostKey: string) => void,
  ): Promise<Uint8Array>
  object(key: string): Promise<PinnedObject>
  deleteObject(key: string): Promise<void>
  pinObject(object: PinnedObject): Promise<void>
  updateObjectMetadata(object: PinnedObject): Promise<void>
  sharedObject(shareUrl: string): Promise<PinnedObject>
  shareObject(object: PinnedObject, validUntilMs: number): string
  objectEvents(
    cursorJson: string | null | undefined,
    limit: number,
  ): Promise<
    Array<{
      id: string
      deleted: boolean
      updatedAt: number
      object: PinnedObject | null
    }>
  >
  generateDataKey(): Uint8Array
  assembleObject(dataKey: Uint8Array, slabsJson: string): PinnedObject
  slabDataSize(): number
  hosts(): Promise<unknown[]>
  account(): Promise<unknown>
  pruneSlabs(): Promise<void>
}

const noop = () => {}

function wrapSDK(native: NativeSDK): SDK {
  return {
    appKey(): AppKey {
      return AppKey._fromNative(native.appKey())
    },
    async upload(
      data: Uint8Array,
      options: UploadOptions,
      onProgress: (current: number, total: number) => void,
    ): Promise<PinnedObject> {
      const result = await native.upload(
        Buffer.from(data),
        options._toNative(),
        onProgress,
      )
      return new PinnedObject(result)
    },
    async download(
      object: PinnedObject,
      options: DownloadOptions,
      onProgress: (current: number, total: number) => void,
    ): Promise<Uint8Array> {
      const result = await native.download(
        object._native,
        options._toNative(),
        onProgress || noop,
        noop,
      )
      return new Uint8Array(result)
    },
    async downloadRange(
      object: PinnedObject,
      offset: number,
      length: number,
      options: DownloadOptions,
      onSector: (hostKey: string) => void,
    ): Promise<Uint8Array> {
      const result = await native.downloadRange(
        object._native,
        offset,
        length,
        options._toNative(),
        onSector || noop,
      )
      return new Uint8Array(result)
    },
    async object(key: string): Promise<PinnedObject> {
      return new PinnedObject(await native.object(key))
    },
    async deleteObject(key: string): Promise<void> {
      return native.deleteObject(key)
    },
    async pinObject(object: PinnedObject): Promise<void> {
      return native.pinObject(object._native)
    },
    async updateObjectMetadata(object: PinnedObject): Promise<void> {
      return native.updateObjectMetadata(object._native)
    },
    async sharedObject(shareUrl: string): Promise<PinnedObject> {
      return new PinnedObject(await native.sharedObject(shareUrl))
    },
    shareObject(object: PinnedObject, validUntilMs: number): string {
      return native.shareObject(object._native, validUntilMs)
    },
    async objectEvents(
      cursorJson: string | null | undefined,
      limit: number,
    ) {
      const events = await native.objectEvents(cursorJson ?? null, limit)
      return events.map((e) => ({
        ...e,
        object: e.object ? new PinnedObject(e.object) : null,
      }))
    },
    generateDataKey(): Uint8Array {
      return new Uint8Array(native.generateDataKey())
    },
    assembleObject(dataKey: Uint8Array, slabsJson: string): PinnedObject {
      return new PinnedObject(
        native.assembleObject(Buffer.from(dataKey), slabsJson),
      )
    },
    slabDataSize(): number {
      return native.slabDataSize()
    },
    async hosts(): Promise<unknown[]> {
      return JSON.parse(await native.hosts())
    },
    async account(): Promise<unknown> {
      return JSON.parse(await native.account())
    },
    async pruneSlabs(): Promise<void> {
      return native.pruneSlabs()
    },
  }
}

export class Builder {
  private _native: NativeBuilder

  constructor(indexerUrl: string) {
    this._native = new (loadNativeAddon().NativeBuilder)(indexerUrl)
  }

  async requestConnection(appMetaJson: string): Promise<void> {
    return this._native.requestConnection(appMetaJson)
  }

  responseUrl(): string {
    return this._native.responseUrl()
  }

  async waitForApproval(): Promise<void> {
    return this._native.waitForApproval()
  }

  setConnectionResponse(appIdHex: string, responseJson: string): void {
    this._native.setConnectionResponse(appIdHex, responseJson)
  }

  async connected(appKey: AppKey): Promise<SDK | null> {
    const native = await this._native.connected(appKey._native)
    if (!native) return null
    return wrapSDK(native)
  }

  async register(mnemonic: string): Promise<SDK> {
    return wrapSDK(await this._native.register(mnemonic))
  }
}

export class SiaClient {
  readonly sdk: SDK
  readonly indexerUrl: string
  readonly keyHex: string

  constructor(sdk: SDK, indexerUrl: string) {
    this.sdk = sdk
    this.indexerUrl = indexerUrl
    const keyBytes = sdk.appKey().export()
    this.keyHex = Array.from(keyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

export async function connect(
  indexerUrl: string,
  appKey: AppKey,
): Promise<SiaClient | null> {
  const builder = new Builder(indexerUrl)
  const sdk = await builder.connected(appKey)
  if (!sdk) return null
  return new SiaClient(sdk, indexerUrl)
}
