/* tslint:disable */
/* eslint-disable */
/**
 * Generates a new 12-word BIP-32 recovery phrase.
 */
export function generateRecoveryPhrase(): string;
/**
 * Validates a BIP-32 recovery phrase.
 */
export function validateRecoveryPhrase(phrase: string): void;
/**
 * Connects to a host via WebTransport and fetches its settings/prices.
 *
 * `address` should be a host address like `host.example.com:9883`.
 * Returns the host settings as a JS object.
 */
export function fetchHostSettings(address: string): Promise<any>;
/**
 * Install a panic hook and logging bridge so that Rust panics show a proper
 * stack trace and `log::debug!()` / `log::info!()` etc. appear in the browser
 * console.
 */
export function init_panic_hook(): void;
/**
 * Sets the log level filter. Accepts "debug", "info", "warn", or "error".
 * Allows JavaScript to control the verbosity of Rust logs at runtime.
 */
export function setLogLevel(level: string): void;
export class AppKey {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Returns the hex-encoded public key.
   */
  publicKey(): string;
  /**
   * Verifies a signature against a message.
   */
  verifySignature(message: Uint8Array, signature: Uint8Array): boolean;
  /**
   * Imports an AppKey from a 64-byte ed25519 keypair or a 32-byte seed.
   */
  constructor(key: Uint8Array);
  /**
   * Signs a message, returning the 64-byte signature.
   */
  sign(message: Uint8Array): Uint8Array;
  /**
   * Exports the full 64-byte ed25519 keypair.
   */
  export(): Uint8Array;
}
export class Builder {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Polls for approval. Resolves when the user approves.
   */
  waitForApproval(): Promise<void>;
  /**
   * Requests a new app connection. Pass app metadata as a JSON object:
   * ```json
   * {
   *   "app_id": [32 bytes as hex],
   *   "name": "My App",
   *   "description": "...",
   *   "service_url": "https://...",
   *   "logo_url": "https://..." (optional),
   *   "callback_url": "https://..." (optional)
   * }
   * ```
   */
  requestConnection(app_meta_json: string): Promise<void>;
  /**
   * Registers the app using the user's recovery phrase and returns the SDK.
   */
  register(mnemonic: string): Promise<SDK>;
  /**
   * Attempts to connect using an existing app key.
   *
   * Returns the SDK if authenticated, or null if the key is not recognized.
   * Call `requestConnection` if null is returned.
   */
  connected(app_key: AppKey): Promise<SDK>;
  /**
   * Returns the response URL the user must visit to authorize the connection.
   */
  responseUrl(): string;
  /**
   * Transitions the builder using a pre-fetched connection response.
   * Use this when the `POST /auth/connect` call was made out-of-band
   * (e.g. via curl) to work around CORS restrictions.
   *
   * `app_id_hex` is the hex-encoded app ID used in the request.
   * `response_json` is the JSON response from `POST /auth/connect`.
   */
  setConnectionResponse(app_id_hex: string, response_json: string): void;
  /**
   * Creates a new SDK builder for the given indexer URL.
   */
  constructor(indexer_url: string);
}
/**
 * Download configuration exposed to JavaScript.
 */
export class DownloadOptions {
  free(): void;
  [Symbol.dispose](): void;
  constructor();
  clone(): DownloadOptions;
  maxInflight: number;
}
/**
 * A packed upload allows multiple objects to be uploaded together in a single
 * upload. This can be more efficient than uploading each object separately if
 * the size of the objects is less than the minimum slab size.
 */
export class PackedUpload {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Adds data to the packed upload. Returns the number of bytes written.
   */
  add(data: Uint8Array): Promise<number>;
  /**
   * Finalizes the upload and returns the resulting PinnedObjects.
   */
  finalize(): Promise<any>;
  /**
   * Returns the number of slabs in the upload.
   */
  slabs(): number;
  /**
   * Cancels the upload. Drops the channel sender which aborts the
   * background upload task.
   */
  cancel(): void;
  /**
   * Returns the total number of bytes added so far.
   */
  length(): number;
  /**
   * Returns the number of bytes remaining until reaching the next slab
   * boundary. Adding objects that fit within this size avoids starting a
   * new slab.
   */
  remaining(): number;
}
export class PinnedObject {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Returns the creation timestamp as milliseconds since the Unix epoch.
   */
  createdAt(): number;
  /**
   * Returns the number of slabs in the object.
   *
   * Useful for sizing a Web Worker pool (cap workers at slab count) and
   * for tracking completion when downloading or uploading slabs in parallel.
   */
  slabCount(): number;
  /**
   * Returns the last-updated timestamp as milliseconds since the Unix epoch.
   */
  updatedAt(): number;
  /**
   * Returns the actual data length of each slab as a JS array of numbers.
   *
   * Useful for computing per-slab byte offsets and for accurate download
   * progress reporting.
   */
  slabLengths(): Array<any>;
  /**
   * Updates the metadata.
   */
  updateMetadata(metadata: Uint8Array): void;
  /**
   * Returns the object's ID as a hex string.
   */
  id(): string;
  /**
   * Opens a sealed object (JSON) using the provided app key.
   */
  static open(app_key: AppKey, sealed_json: string): PinnedObject;
  /**
   * Seals the object for offline storage, returning JSON.
   */
  seal(app_key: AppKey): string;
  /**
   * Returns the total size of the object in bytes.
   */
  size(): number;
  /**
   * Returns the slab layout as a JSON array.
   *
   * Each element contains `offset`, `length`, `minShards`, and `hostKeys`
   * (an array of host public-key strings identifying which hosts store
   * each sector of the slab).
   */
  slabs(): any;
  /**
   * Returns the metadata as a Uint8Array.
   */
  metadata(): Uint8Array;
}
export class SDK {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Pins an object to the indexer.
   */
  pinObject(object: PinnedObject): Promise<void>;
  /**
   * Prunes unused slabs from the indexer.
   */
  pruneSlabs(): Promise<void>;
  /**
   * Uploads a single slab's worth of raw data with object-level encryption
   * at the given stream offset. Returns the slab metadata as JSON.
   *
   * Used by parallel upload workers. Each worker calls this with a different
   * chunk of the file and the correct stream offset. The shared data_key
   * ensures all slabs can be decrypted together.
   *
   * The `on_progress` callback receives `(current_shards, total_shards)`.
   */
  uploadSlab(data: Uint8Array, data_key: Uint8Array, stream_offset: number, options: UploadOptions, on_progress: Function): Promise<string>;
  /**
   * Deletes an object from the indexer by its hex-encoded key.
   */
  deleteObject(key: string): Promise<void>;
  /**
   * Returns object events for syncing. Supports cursor-based pagination.
   *
   * `cursor_json` is an optional JSON string: `{"id": "hex...", "after": <epoch_ms>}`
   * `limit` is the maximum number of events to return.
   *
   * Returns a JS array of objects:
   * `[{ id: string, deleted: bool, updatedAt: number, object: PinnedObject | null }]`
   */
  objectEvents(cursor_json: string | null | undefined, limit: number): Promise<any>;
  /**
   * Retrieves a shared object from a signed share URL.
   * Accepts both `https://` and `sia://` schemes.
   */
  sharedObject(share_url: string): Promise<PinnedObject>;
  /**
   * Downloads a byte range from an object, returning the decrypted data as a Uint8Array.
   *
   * Only downloads the slabs that overlap the requested range, making this
   * much more efficient than `download()` for small reads from large objects.
   *
   * The `on_sector` callback is called with the host public key string for
   * each sector successfully downloaded.
   */
  downloadRange(object: PinnedObject, offset: number, length: number, options: DownloadOptions, on_sector: Function): Promise<Uint8Array>;
  /**
   * Downloads an object with streaming chunks.
   * Fires `on_chunk(bytes)` after each slab is decoded and `on_progress(current, total)` for progress.
   */
  downloadStreaming(object: PinnedObject, options: DownloadOptions, on_chunk: Function, on_progress: Function): Promise<void>;
  /**
   * Downloads a single slab by index, returning its decrypted data as a Uint8Array.
   *
   * Used by slab download workers to enable parallel slab downloads across
   * multiple Web Workers, each with their own SDK instance and thread.
   */
  downloadSlabByIndex(object: PinnedObject, slab_index: number, options: DownloadOptions, on_sector: Function): Promise<Uint8Array>;
  /**
   * Updates the metadata of an object already stored in the indexer.
   */
  updateObjectMetadata(object: PinnedObject): Promise<void>;
  /**
   * Finalizes a chunked upload and returns the PinnedObject.
   * on_progress callback receives (current_shards, total_shards).
   */
  finalizeChunkedUpload(session_id: number, options: UploadOptions, on_progress: Function): Promise<PinnedObject>;
  /**
   * Returns hosts as a JSON array.
   */
  hosts(): Promise<any>;
  /**
   * Retrieves a pinned object by its hex-encoded key.
   */
  object(key: string): Promise<PinnedObject>;
  /**
   * Uploads a Uint8Array with per-shard progress reporting.
   *
   * The `on_progress` callback receives `(current_shards, total_shards)`.
   */
  upload(data: Uint8Array, options: UploadOptions, on_progress: Function): Promise<PinnedObject>;
  /**
   * Returns account information as a JS object.
   */
  account(): Promise<any>;
  /**
   * Downloads an object's data with per-slab progress reporting.
   *
   * The `on_progress` callback receives `(current_slabs, total_slabs)`.
   */
  download(object: PinnedObject, options: DownloadOptions, on_progress: Function): Promise<Uint8Array>;
  /**
   * Creates a share URL for an object, valid until the given timestamp (ms since epoch).
   */
  shareObject(object: PinnedObject, valid_until_ms: number): string;
  /**
   * Adds a chunk to an existing upload session.
   * Returns the current offset after adding this chunk.
   */
  uploadChunk(session_id: number, chunk: Uint8Array): number;
  /**
   * Creates a new packed upload. Multiple objects can be added to the
   * upload and they will share slabs, reducing wasted space for small files.
   *
   * Returns a `PackedUpload` handle with `add()`, `finalize()`, and `cancel()` methods.
   */
  uploadPacked(options: UploadOptions): PackedUpload;
  /**
   * Returns the slab data size for default options (data_shards * SECTOR_SIZE).
   * Prefer `UploadOptions.slabDataSize()` for custom shard counts.
   */
  slabDataSize(): number;
  /**
   * Assembles a PinnedObject from a data key and an array of slab metadata JSONs.
   *
   * Used after parallel upload workers have uploaded all slabs independently.
   * The main thread collects the slab JSONs and calls this to create the
   * final object that can be pinned to the indexer.
   */
  assembleObject(data_key: Uint8Array, slabs_json: string): PinnedObject;
  /**
   * Starts a streaming upload that reads chunks on-demand from JavaScript.
   * This bypasses WASM memory limitations by never accumulating the entire file.
   *
   * Returns a StreamingUpload object with a `pushChunk` method and a `promise` property.
   * JavaScript should:
   * 1. Start pushing chunks immediately using `pushChunk(chunk)`
   * 2. Call `pushChunk(null)` to signal EOF when all chunks are sent
   * 3. `await upload.promise` to get the uploaded object
   *
   * # Example JavaScript Usage
   * ```javascript
   * const totalSize = file.size;
   * const upload = sdk.streamingUpload(totalSize, (current, total) => {
   *   console.log(`Progress: ${current}/${total} shards`);
   * });
   *
   * // Read and push chunks asynchronously
   * (async () => {
   *   const CHUNK_SIZE = 128 * 1024 * 1024; // 128 MB
   *   for (let offset = 0; offset < totalSize; offset += CHUNK_SIZE) {
   *     const chunk = file.slice(offset, offset + CHUNK_SIZE);
   *     const data = new Uint8Array(await chunk.arrayBuffer());
   *     upload.pushChunk(data);
   *   }
   *   upload.pushChunk(null); // Signal EOF
   * })();
   *
   * // Wait for upload to complete
   * const obj = await upload.promise;
   * ```
   */
  streamingUpload(total_size: number, options: UploadOptions, on_progress: Function): StreamingUpload;
  /**
   * Generates a random 32-byte encryption key for object-level encryption.
   * Used by parallel upload workers that share a single data key.
   */
  generateDataKey(): Uint8Array;
  /**
   * Starts a new chunked upload session with the total file size.
   * Returns a session ID (as a number) to track this upload.
   *
   * Note: Due to WASM 32-bit limitations, maximum file size is approximately 1.5 GB.
   */
  startChunkedUpload(total_size: number): number;
  /**
   * Returns the app key used by this SDK instance.
   */
  appKey(): AppKey;
}
/**
 * Handle for a streaming upload operation.
 * JavaScript should call `pushChunk(data)` for each chunk, then `pushChunk(null)` to signal EOF.
 * The `promise` resolves to a PinnedObject when the upload completes.
 */
export class StreamingUpload {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Pushes a chunk of data to the upload.
   * Pass data as Uint8Array. Call with `null` or `undefined` to signal EOF.
   *
   * **Backpressure**: This method applies backpressure to prevent memory exhaustion.
   * It returns a Promise that resolves when the chunk has been queued.
   * If the queue is full, it waits until space becomes available.
   *
   * **IMPORTANT**: JavaScript MUST await this Promise before pushing the next chunk:
   * ```javascript
   * await upload.pushChunk(data);  // ← await here!
   * ```
   */
  pushChunk(chunk?: Uint8Array | null): Promise<any>;
  /**
   * Returns the promise that resolves when the upload completes
   */
  readonly promise: Promise<any>;
}
/**
 * Upload configuration exposed to JavaScript.
 */
export class UploadOptions {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Size in bytes of data per slab (data_shards * SECTOR_SIZE).
   */
  slabDataSize(): number;
  constructor();
  clone(): UploadOptions;
  dataShards: number;
  parityShards: number;
  maxInflight: number;
  readonly totalShardsPerSlab: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_appkey_free: (a: number, b: number) => void;
  readonly __wbg_builder_free: (a: number, b: number) => void;
  readonly __wbg_downloadoptions_free: (a: number, b: number) => void;
  readonly __wbg_get_downloadoptions_maxInflight: (a: number) => number;
  readonly __wbg_get_uploadoptions_dataShards: (a: number) => number;
  readonly __wbg_get_uploadoptions_parityShards: (a: number) => number;
  readonly __wbg_packedupload_free: (a: number, b: number) => void;
  readonly __wbg_pinnedobject_free: (a: number, b: number) => void;
  readonly __wbg_sdk_free: (a: number, b: number) => void;
  readonly __wbg_set_downloadoptions_maxInflight: (a: number, b: number) => void;
  readonly __wbg_set_uploadoptions_dataShards: (a: number, b: number) => void;
  readonly __wbg_set_uploadoptions_parityShards: (a: number, b: number) => void;
  readonly __wbg_streamingupload_free: (a: number, b: number) => void;
  readonly __wbg_uploadoptions_free: (a: number, b: number) => void;
  readonly appkey_export: (a: number) => any;
  readonly appkey_new: (a: number, b: number) => [number, number, number];
  readonly appkey_publicKey: (a: number) => [number, number];
  readonly appkey_sign: (a: number, b: number, c: number) => any;
  readonly appkey_verifySignature: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly builder_connected: (a: number, b: number) => any;
  readonly builder_new: (a: number, b: number) => [number, number, number];
  readonly builder_register: (a: number, b: number, c: number) => any;
  readonly builder_requestConnection: (a: number, b: number, c: number) => any;
  readonly builder_responseUrl: (a: number) => [number, number, number, number];
  readonly builder_setConnectionResponse: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly builder_waitForApproval: (a: number) => any;
  readonly downloadoptions_clone: (a: number) => number;
  readonly downloadoptions_new: () => number;
  readonly fetchHostSettings: (a: number, b: number) => any;
  readonly generateRecoveryPhrase: () => [number, number];
  readonly init_panic_hook: () => void;
  readonly packedupload_add: (a: number, b: number, c: number) => any;
  readonly packedupload_cancel: (a: number) => [number, number];
  readonly packedupload_finalize: (a: number) => any;
  readonly packedupload_length: (a: number) => number;
  readonly packedupload_remaining: (a: number) => number;
  readonly packedupload_slabs: (a: number) => number;
  readonly pinnedobject_createdAt: (a: number) => [number, number, number];
  readonly pinnedobject_id: (a: number) => [number, number, number, number];
  readonly pinnedobject_metadata: (a: number) => [number, number, number];
  readonly pinnedobject_open: (a: number, b: number, c: number) => [number, number, number];
  readonly pinnedobject_seal: (a: number, b: number) => [number, number, number, number];
  readonly pinnedobject_size: (a: number) => [number, number, number];
  readonly pinnedobject_slabCount: (a: number) => [number, number, number];
  readonly pinnedobject_slabLengths: (a: number) => [number, number, number];
  readonly pinnedobject_slabs: (a: number) => [number, number, number];
  readonly pinnedobject_updateMetadata: (a: number, b: number, c: number) => [number, number];
  readonly pinnedobject_updatedAt: (a: number) => [number, number, number];
  readonly sdk_account: (a: number) => any;
  readonly sdk_appKey: (a: number) => number;
  readonly sdk_assembleObject: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly sdk_deleteObject: (a: number, b: number, c: number) => any;
  readonly sdk_download: (a: number, b: number, c: number, d: any) => any;
  readonly sdk_downloadRange: (a: number, b: number, c: number, d: number, e: number, f: any) => any;
  readonly sdk_downloadSlabByIndex: (a: number, b: number, c: number, d: number, e: any) => any;
  readonly sdk_downloadStreaming: (a: number, b: number, c: number, d: any, e: any) => any;
  readonly sdk_finalizeChunkedUpload: (a: number, b: number, c: number, d: any) => any;
  readonly sdk_generateDataKey: (a: number) => any;
  readonly sdk_hosts: (a: number) => any;
  readonly sdk_object: (a: number, b: number, c: number) => any;
  readonly sdk_objectEvents: (a: number, b: number, c: number, d: number) => any;
  readonly sdk_pinObject: (a: number, b: number) => any;
  readonly sdk_pruneSlabs: (a: number) => any;
  readonly sdk_shareObject: (a: number, b: number, c: number) => [number, number, number, number];
  readonly sdk_sharedObject: (a: number, b: number, c: number) => any;
  readonly sdk_slabDataSize: (a: number) => number;
  readonly sdk_startChunkedUpload: (a: number, b: number) => [number, number, number];
  readonly sdk_streamingUpload: (a: number, b: number, c: number, d: any) => [number, number, number];
  readonly sdk_updateObjectMetadata: (a: number, b: number) => any;
  readonly sdk_upload: (a: number, b: number, c: number, d: number, e: any) => any;
  readonly sdk_uploadChunk: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly sdk_uploadPacked: (a: number, b: number) => number;
  readonly sdk_uploadSlab: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any) => any;
  readonly setLogLevel: (a: number, b: number) => void;
  readonly streamingupload_promise: (a: number) => any;
  readonly streamingupload_pushChunk: (a: number, b: number, c: number) => any;
  readonly uploadoptions_clone: (a: number) => number;
  readonly uploadoptions_new: () => number;
  readonly uploadoptions_slabDataSize: (a: number) => number;
  readonly uploadoptions_totalShardsPerSlab: (a: number) => number;
  readonly validateRecoveryPhrase: (a: number, b: number) => [number, number];
  readonly __wbg_set_uploadoptions_maxInflight: (a: number, b: number) => void;
  readonly __wbg_get_uploadoptions_maxInflight: (a: number) => number;
  readonly wasm_bindgen_87aa27fb821f84de___convert__closures_____invoke___wasm_bindgen_87aa27fb821f84de___JsValue_____: (a: number, b: number, c: any) => void;
  readonly wasm_bindgen_87aa27fb821f84de___closure__destroy___dyn_core_9c0b49b6ed63a8be___ops__function__FnMut__wasm_bindgen_87aa27fb821f84de___JsValue____Output_______: (a: number, b: number) => void;
  readonly wasm_bindgen_87aa27fb821f84de___convert__closures_____invoke______: (a: number, b: number) => void;
  readonly wasm_bindgen_87aa27fb821f84de___closure__destroy___dyn_core_9c0b49b6ed63a8be___ops__function__FnMut_____Output_______: (a: number, b: number) => void;
  readonly wasm_bindgen_87aa27fb821f84de___convert__closures_____invoke___wasm_bindgen_87aa27fb821f84de___JsValue__wasm_bindgen_87aa27fb821f84de___JsValue_____: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
