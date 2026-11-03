import { ShardProgress, AppMetadata, Sdk, SharedSdk, PinnedObject } from '../wasm/sia_storage_wasm.js';
export { Account, AppKey, AppMetadata, Builder, DownloadOptions, Host, HostQuery, KeyRecord, KeyStats, ObjectEvent, ObjectEventSummary, ObjectSummary, PackedUpload, PinnedObject, PreAuthorizedKey, PreAuthorizedKeyRequest, Sdk, SealedObject, Sector, ShardProgress, SharedSdk, SharingKey, SignedPreAuthorizedKeyRequest, Slab, UploadOptions, encodedSize, generateRecoveryPhrase, setLogger, validateRecoveryPhrase } from '../wasm/sia_storage_wasm.js';

declare function detectPrivateRelay(): Promise<boolean>;

/**
 * Messages between a page and its streaming service worker.
 *
 * Stream URLs carry only the page's client id and a random token. When the
 * worker meets a token it does not know, it asks the page that made it for the
 * file and the share's credentials. The page and a worker can come from
 * different deployed versions, so the worker checks the page's reply before
 * using it.
 */

/**
 * What a stream URL is doing. `connecting` is a request waiting for its first
 * bytes, which on the URL's first request includes the worker connecting its
 * SDK and finding the object. `downloading` means bytes are arriving. `idle`
 * means no request for the URL is in flight, after the last one finished, was
 * cancelled or failed.
 */
type StreamStatus = 'connecting' | 'downloading' | 'idle';
/**
 * How much of the worker's log a page asked for. Each level includes the ones
 * before it, so `warn` gets warnings and errors.
 */
type StreamLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Previews and downloads for pages that cannot stream through the service
 * worker, where the page reads the object itself. A preview holds the whole
 * file in memory as a Blob. A download writes straight to disk through the
 * save picker where the browser has one, and buffers a Blob where it does not.
 */

/** What a file reports while it downloads, on the worker or in the page. */
type FileEvents = {
    /**
     * Total bytes this URL has received. It is a transfer count, not how much of
     * the file is held: a range read again after a seek counts again, so it can
     * pass the file size, and a new URL for the same file starts from zero. For
     * how much of a video is buffered, read the media element's `buffered`.
     */
    onProgress?: (bytesDownloaded: number) => void;
    /**
     * One call per piece the SDK read from a host. A download reads each slab in
     * chunks, so the same slab and shard come again for every chunk, and only
     * the first `minShards` hosts to answer for a chunk are reported.
     */
    onShard?: (progress: ShardProgress) => void;
    /** Each change of what the URL is doing. See `StreamStatus`. */
    onStatus?: (status: StreamStatus) => void;
};

/**
 * The page side of streaming.
 *
 * `openStreams` hands out same-origin URLs that the library's service worker
 * answers with ranged reads of an object, so a `<video>` seeks without loading
 * the whole file and a download goes to the browser's download manager instead
 * of the page's memory. The worker connects its own SDK of the same kind, with
 * credentials this page hands it over a message port and it keeps in memory.
 * Where the worker is unavailable, the same calls read the object in the page.
 */

type StreamingOptions = {
    /** Where the site serves the worker file. Defaults to `/sia-storage-sw.js`. */
    workerUrl?: string;
    /** The worker's scope. Defaults to the directory `workerUrl` is in. */
    scope?: string;
    /** `'module'` when `workerUrl` is an ES module worker of your own. */
    type?: WorkerType;
    /**
     * Prints the streaming worker's log in this page's console, which otherwise
     * never shows it, prefixed `[Sia stream worker]`. That is the SDK's log at
     * this level and above, and at `error`, any SDK panic and any error the
     * worker did not catch. Off when unset. URL query strings and fragments are
     * cut from each line, since indexer requests are signed in theirs. The log
     * covers every page the worker serves, not only this one's streams.
     */
    logLevel?: StreamLogLevel;
};
/** What a `SharedSdk` was connected with. */
type SharedCredentials = {
    indexerUrl: string;
    seed: string;
};
/** What an `Sdk`'s `Builder` was made with. The key comes from `sdk.appKey()`. */
type AppCredentials = {
    indexerUrl: string;
    appMeta: AppMetadata;
};
/** The credentials `openStreams` takes for each kind of SDK. */
type CredentialsFor<S extends Sdk | SharedSdk> = S extends SharedSdk ? SharedCredentials : AppCredentials;
type FileOptions = FileEvents & {
    /** Used for downloads and for the browser's media handling. */
    name: string;
    /** The MIME type. Defaults to `application/octet-stream`. */
    type?: string;
    /** A failure after streaming started. Without it, failures are logged. */
    onError?: (message: string) => void;
};
/** A URL for an `<img>`, `<video>`, `<audio>`, `<iframe>` or `fetch`. */
type StreamedFile = {
    url: string;
    /** The whole file, when the page read it itself instead of streaming. */
    blob?: Blob;
    /**
     * Opens connections to the hosts holding the start of the file, so a play
     * that follows gets its first bytes sooner. It reads one byte, which asks
     * each host of the first slab for a single 64-byte segment, and reports no
     * status or progress. Resolves when the byte arrives, or at once for a file
     * the page read itself. Never rejects, since a play still works without it.
     * Call it when a play is likely, such as when the pointer reaches a Play
     * button. The earlier before the play, the more it saves.
     */
    warm(): Promise<void>;
    /** Frees the URL. Call it when the element showing it goes away. */
    release(): void;
};
type Streams = {
    /** A URL serving the object. Streams where it can, else reads it whole. */
    url(object: PinnedObject, options: FileOptions & {
        signal?: AbortSignal;
    }): Promise<StreamedFile>;
    /**
     * Saves the object, from a click handler. Streams to the browser's download
     * manager where it can, else opens the save picker, else saves a Blob.
     * Awaits nothing before the picker opens, so the browser still counts it as
     * part of the click.
     */
    download(object: PinnedObject, options: FileOptions): Promise<'streaming' | 'saved' | 'cancelled'>;
    /**
     * Cancels the streams this handle made. Other handles on the same SDK keep
     * theirs. Call it when you stop using the handle.
     */
    close(): void;
};
/**
 * Registers the streaming worker and resolves whether this page can stream.
 * `openStreams` calls it with the defaults, so call it yourself only to pass
 * options, and before the first `openStreams`. Later calls return the first
 * call's answer, except when setup failed or timed out and a different worker
 * has since taken control of the page. Then the next call tries again, with
 * the first call's options.
 */
declare function enableStreaming(options?: StreamingOptions): Promise<boolean>;
/**
 * Previews and downloads for one SDK's objects, from an `Sdk` or a `SharedSdk`.
 *
 * The worker cannot use this page's SDK, so it connects its own with
 * `credentials`: the indexer URL and seed a `SharedSdk` was connected with, or
 * the indexer URL and app metadata an `Sdk`'s `Builder` was made with.
 */
declare function openStreams<S extends Sdk | SharedSdk>(sdk: S, credentials: CredentialsFor<S>): Streams;

/** Initialize the WASM module. Safe to call multiple times. */
declare function initSia(): Promise<void>;

export { type AppCredentials, type CredentialsFor, type FileEvents, type FileOptions, type SharedCredentials, type StreamLogLevel, type StreamStatus, type StreamedFile, type StreamingOptions, type Streams, detectPrivateRelay, enableStreaming, initSia, openStreams };
