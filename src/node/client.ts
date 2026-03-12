import { loadNativeAddon } from './load'

// ── Native types (from NAPI addon) ──────────────────────────────

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

// ── Progress types (identical to WASM) ──────────────────────────

export type UploadProgress = {
  phase: 'connecting' | 'uploading' | 'assembling' | 'pinning'
  slabsComplete: number
  slabsTotal: number
  shardsComplete: number
  shardsTotal: number
  hosts?: string[]
}

export type DownloadProgress = {
  phase: 'connecting' | 'downloading' | 'assembling'
  slabsComplete: number
  slabsTotal: number
  bytesComplete: number
  bytesTotal: number
  hostKey?: string
}

export type DownloadConfig = {
  workers?: number
  range?: { offset: number; length: number }
  maxInflight?: number
}

// ── Wrapper classes ─────────────────────────────────────────────

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

// ── Internal SDK wrapper ────────────────────────────────────────

class UploadOptions {
  dataShards?: number
  parityShards?: number
  maxInflight: number = 8

  _toNative(): NativeUploadOptions {
    return {
      dataShards: this.dataShards,
      parityShards: this.parityShards,
      maxInflight: this.maxInflight,
    }
  }
}

class DownloadOptions {
  maxInflight: number = 10

  _toNative(): NativeDownloadOptions {
    return {
      maxInflight: this.maxInflight,
    }
  }
}

type SDK = {
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

// ── SiaClient ───────────────────────────────────────────────────

export class SiaClient {
  #sdk: SDK
  #indexerUrl: string
  #keyHex: string

  constructor(sdk: SDK, indexerUrl: string) {
    this.#sdk = sdk
    this.#indexerUrl = indexerUrl
    const keyBytes = sdk.appKey().export()
    this.#keyHex = Array.from(keyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  // ── Upload / Download ────────────────────────────────────────

  /**
   * Upload a file to Sia. Parallelism is handled natively by the Rust
   * runtime (tokio).
   */
  async upload(
    file: File | Uint8Array,
    onProgress: (p: UploadProgress) => void,
    options?: { workers?: number },
  ): Promise<PinnedObject> {
    let data: Uint8Array
    if (file instanceof File) {
      data = new Uint8Array(await file.arrayBuffer())
    } else {
      data = file
    }

    const opts = new UploadOptions()

    onProgress({
      phase: 'uploading',
      slabsComplete: 0,
      slabsTotal: 0,
      shardsComplete: 0,
      shardsTotal: 0,
    })

    const result = await this.#sdk.upload(data, opts, (current, total) => {
      onProgress({
        phase: 'uploading',
        slabsComplete: 0,
        slabsTotal: 0,
        shardsComplete: current,
        shardsTotal: total,
      })
    })

    onProgress({
      phase: 'assembling',
      slabsComplete: 0,
      slabsTotal: 0,
      shardsComplete: 0,
      shardsTotal: 0,
    })

    return result
  }

  /**
   * Download an object from Sia. Supports byte-range requests via
   * config.range. Parallelism is handled natively by the Rust runtime.
   */
  async download(
    object: PinnedObject,
    onProgress?: (p: DownloadProgress) => void,
    config?: DownloadConfig,
  ): Promise<Uint8Array> {
    const { maxInflight = 10 } = config ?? {}
    const totalBytes = object.size()

    if (config?.range) {
      return this.downloadRange(object, config.range.offset, config.range.length, {
        maxInflight,
      })
    }

    onProgress?.({
      phase: 'downloading',
      slabsComplete: 0,
      slabsTotal: object.slabCount(),
      bytesComplete: 0,
      bytesTotal: totalBytes,
    })

    const opts = new DownloadOptions()
    opts.maxInflight = maxInflight

    const data = await this.#sdk.download(object, opts, (current, total) => {
      onProgress?.({
        phase: 'downloading',
        slabsComplete: current,
        slabsTotal: total,
        bytesComplete: 0,
        bytesTotal: totalBytes,
      })
    })

    onProgress?.({
      phase: 'assembling',
      slabsComplete: object.slabCount(),
      slabsTotal: object.slabCount(),
      bytesComplete: totalBytes,
      bytesTotal: totalBytes,
    })

    return data
  }

  /**
   * Download a byte range from an object. Only the overlapping slabs are
   * fetched. Runs on the main thread.
   */
  async downloadRange(
    object: PinnedObject,
    offset: number,
    length: number,
    options?: { maxInflight?: number; onHost?: (hostKey: string) => void },
  ): Promise<Uint8Array> {
    const opts = new DownloadOptions()
    opts.maxInflight = options?.maxInflight ?? 10
    return this.#sdk.downloadRange(
      object,
      offset,
      length,
      opts,
      options?.onHost ?? noop,
    )
  }

  // ── Object operations ────────────────────────────────────────

  appKey(): AppKey {
    return this.#sdk.appKey()
  }

  async object(key: string): Promise<PinnedObject> {
    return this.#sdk.object(key)
  }

  async deleteObject(key: string): Promise<void> {
    return this.#sdk.deleteObject(key)
  }

  async pinObject(object: PinnedObject): Promise<void> {
    return this.#sdk.pinObject(object)
  }

  async updateObjectMetadata(object: PinnedObject): Promise<void> {
    return this.#sdk.updateObjectMetadata(object)
  }

  async sharedObject(shareUrl: string): Promise<PinnedObject> {
    return this.#sdk.sharedObject(shareUrl)
  }

  shareObject(object: PinnedObject, validUntilMs: number): string {
    return this.#sdk.shareObject(object, validUntilMs)
  }

  async objectEvents(
    cursor: string | null | undefined,
    limit: number,
  ): Promise<
    Array<{
      id: string
      deleted: boolean
      updatedAt: number
      object: PinnedObject | null
    }>
  > {
    return this.#sdk.objectEvents(cursor, limit)
  }

  async hosts(): Promise<unknown[]> {
    return this.#sdk.hosts()
  }

  async account(): Promise<unknown> {
    return this.#sdk.account()
  }

  async pruneSlabs(): Promise<void> {
    return this.#sdk.pruneSlabs()
  }
}

// ── Builder ─────────────────────────────────────────────────────

export class Builder {
  #native: NativeBuilder
  #indexerUrl: string

  constructor(indexerUrl: string) {
    this.#native = new (loadNativeAddon().NativeBuilder)(indexerUrl)
    this.#indexerUrl = indexerUrl
  }

  async requestConnection(appMetaJson: string): Promise<void> {
    return this.#native.requestConnection(appMetaJson)
  }

  responseUrl(): string {
    return this.#native.responseUrl()
  }

  async waitForApproval(): Promise<void> {
    return this.#native.waitForApproval()
  }

  setConnectionResponse(appIdHex: string, responseJson: string): void {
    this.#native.setConnectionResponse(appIdHex, responseJson)
  }

  async connected(appKey: AppKey): Promise<SiaClient | null> {
    const native = await this.#native.connected(appKey._native)
    if (!native) return null
    return new SiaClient(wrapSDK(native), this.#indexerUrl)
  }

  async register(mnemonic: string): Promise<SiaClient> {
    const sdk = wrapSDK(await this.#native.register(mnemonic))
    return new SiaClient(sdk, this.#indexerUrl)
  }
}

export async function connect(
  indexerUrl: string,
  appKey: AppKey,
): Promise<SiaClient | null> {
  const builder = new Builder(indexerUrl)
  return builder.connected(appKey)
}
