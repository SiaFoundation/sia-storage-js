import {
  AppKey,
  Builder as WasmBuilder,
  DownloadOptions,
  PinnedObject,
  type SDK,
} from './init'
import { toHex } from '../hex'
import { uploadImpl, type UploadProgress } from '../parallel-upload'
import { downloadImpl, type DownloadConfig, type DownloadProgress } from '../parallel-download'

export class SiaClient {
  #sdk: SDK
  #indexerUrl: string
  #keyHex: string

  constructor(sdk: SDK, indexerUrl: string) {
    this.#sdk = sdk
    this.#indexerUrl = indexerUrl
    this.#keyHex = toHex(sdk.appKey().export())
  }

  // ── Upload / Download ──────────────────────────────────────────

  /**
   * Upload a file to Sia. Small files (≤40 MiB) are uploaded on the main
   * thread. Larger files are split into slabs and uploaded in parallel
   * using Web Workers.
   */
  async upload(
    file: File | Uint8Array,
    onProgress: (p: UploadProgress) => void,
    options?: { workers?: number },
  ): Promise<PinnedObject> {
    return uploadImpl(
      this.#sdk,
      this.#keyHex,
      this.#indexerUrl,
      file,
      onProgress,
      options?.workers,
    )
  }

  /**
   * Download an object from Sia. Small objects (≤40 MiB) are downloaded on
   * the main thread. Larger objects use a pool of Web Workers for parallel
   * slab retrieval. Supports byte-range requests via config.range.
   */
  async download(
    object: PinnedObject,
    onProgress?: (p: DownloadProgress) => void,
    config?: DownloadConfig,
  ): Promise<Uint8Array> {
    return downloadImpl(
      this.#sdk,
      this.#keyHex,
      this.#indexerUrl,
      object,
      onProgress,
      config,
    )
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
      options?.onHost ?? (() => {}),
    )
  }

  // ── Object operations ──────────────────────────────────────────

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

export class Builder {
  #inner: WasmBuilder
  #indexerUrl: string

  constructor(indexerUrl: string) {
    this.#inner = new WasmBuilder(indexerUrl)
    this.#indexerUrl = indexerUrl
  }

  async requestConnection(appMetaJson: string): Promise<void> {
    return this.#inner.requestConnection(appMetaJson)
  }

  responseUrl(): string {
    return this.#inner.responseUrl()
  }

  async waitForApproval(): Promise<void> {
    return this.#inner.waitForApproval()
  }

  setConnectionResponse(appIdHex: string, responseJson: string): void {
    this.#inner.setConnectionResponse(appIdHex, responseJson)
  }

  async connected(appKey: AppKey): Promise<SiaClient | null> {
    const sdk = await this.#inner.connected(appKey)
    if (!sdk) return null
    return new SiaClient(sdk, this.#indexerUrl)
  }

  async register(mnemonic: string): Promise<SiaClient> {
    const sdk = await this.#inner.register(mnemonic)
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
