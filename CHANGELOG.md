# Changelog
## 0.2.0 (2026-10-28)

### Breaking Changes

#### `Builder.connectPreAuthorized` takes a `PreAuthorizedKey`

`Builder.connectPreAuthorized(key, phrase)` now takes a `PreAuthorizedKey` instead of the
key's 32-byte seed. Callers holding a seed can pass `PreAuthorizedKey.import(seed)`.

### Features

- Host performance metrics and the price cache are now shared across all SDK instances.

#### Added `PreAuthorizedKey` helpers for random key generation, seed import/export, and signing indexer creation requests.

Exports `PreAuthorizedKey` from both the browser and Node entry points, along with the
`PreAuthorizedKeyRequest` and `SignedPreAuthorizedKeyRequest` types on the browser entry
point. The key generates itself with `new PreAuthorizedKey()` or imports a 32-byte seed
with `PreAuthorizedKey.import(seed)`, exports that seed again, signs and verifies
messages, and signs a request that creates the key in the indexer.

### Fixes

- Fixed an Android crash on the first HTTPS request in apps that load React Native.
- Appending data now efficiently repacks the last slab when it is not full.

## 0.1.6 (2026-10-23)

### Features

#### Update sia-sdk-rs (napi v0.11.2, wasm v0.8.3)

Adds `Sdk.objectEventSummaries(cursor?, limit)` and the `ObjectEventSummary` class it
returns, which lists the same object events as `objectEvents` without the objects'
slabs, so the response is much smaller. Each event carries an `ObjectSummary`; fetch the
full object with `Sdk.object(id)` to download it. The release also fixes connecting to
hosts that announce an IPv6 address, a crash reading a slab whose sectors include a host
the SDK does not know, and account tokens expiring before a read reaches the host. In the browser, it also
closes WebTransport streams whose open was abandoned, which piled up until a host stopped
accepting new ones, and stops redialing hosts that refused a handshake, whose failures
made Chrome delay every new connection by up to a minute.

#### Print the streaming worker's log in the page with `logLevel`

`enableStreaming({ logLevel })` prints the streaming service worker's log in the page's console, prefixed `[Sia stream worker]`. A service worker's console is separate from the page's, so a panic in the SDK inside the worker froze a video with nothing in the page's console to say why. The page receives the SDK's log at the level it asked for and above, and at `error` also SDK panics and errors the worker did not catch. The worker sets the SDK's logger only once a page asks, to the most verbose level any open page asked for, and sends lines in batches every 250 ms, with errors at once. It cuts the query string and fragment from every URL in a line, since the SDK signs its indexer requests in the query string. Off by default. A page and worker from different versions still work together: a page without `logLevel` gets no lines, and a worker from before it ignores the option.

## 0.1.5 (2026-10-19)

### Fixes

#### Keep streamed downloads running in Firefox

Firefox stopped the streaming worker about 30 seconds into a download and saved the bytes it had as a finished file, with no error. A 4 GB file came out as about 120 MB. Firefox stops a service worker 30 seconds after the last event it received, even while it is still serving a response, and a download sends the worker nothing after its first request. The worker now tells the page when it starts and stops serving its requests, and the page sends it a message every 10 seconds in between. A video stream that reads for more than 30 seconds without a new request is kept running the same way. Chrome keeps the worker running while it serves a response, so it was not affected.

## 0.1.4 (2026-10-13)

### Features

#### Update sia-sdk-rs (napi v0.11.1, wasm v0.8.1)

Adds `sharedSdk.objectSummaries(offset, limit)`, which lists a sharing key's objects without their slabs, along with the `ObjectSummary` type it returns. The SDK asks the indexer for CBOR responses and falls back to JSON. `sdk.pruneSlabs()` now takes an optional `before` cutoff. `sdk.slab(id)` and the `PinnedSlab` type are removed upstream and no longer exported, and `encodedSize` now throws when data shards is zero rather than aborting the process.

#### Open a stream's host connections before Play with `warm()`

`StreamedFile.warm()` opens connections to the hosts holding the start of the file before a play, by reading one byte without reporting any status or progress. A stream otherwise connects to its hosts only when the video asks for its first bytes, which takes a few seconds. Call it when a play is likely, such as when the pointer reaches a Play button. It resolves when the byte arrives, or at once for a file the page read itself, and never rejects.

### Fixes

#### Free the app key copy when streams close

`openStreams` on an `Sdk` takes a copy of its app key to seal objects for the worker. `close()` now frees that copy, which was kept until the page went away.

#### Start shared streams without looking the file up again

A stream from a `SharedSdk` no longer makes the service worker ask the indexer for a file the page already has. The page seals the file's record with a random key that only it and its worker know, and the worker opens it. That lookup takes about 0.2 seconds before a video's first byte against the production indexer, and took up to 7 seconds while the indexer was under load. A page and worker from different versions still work together, since a worker that receives no key looks the file up as before.

## 0.1.3 (2026-10-07)

### Features

#### Report status and progress for streamed files

Streamed files now report what they're doing. `url()` and `download()` from `openStreams` take `onStatus`, `onProgress` and `onShard`, so a page can show whether a stream is connecting, receiving or done, how many bytes have arrived and which hosts sent them. `onStatus` goes `connecting` until the first bytes, then `downloading`, then `idle` when no read is in flight, and around again on a seek. `onProgress` reports the total bytes the URL has received, and now works while streaming as well as when the page reads the file itself. `onShard` reports each piece the SDK reads from a host. The worker sends only the reports a URL asked for, batches bytes and shards at most every 100 ms and just before each status change, and stops when the URL is released.

## 0.1.2 (2026-10-06)

### Fixes

#### Explain why the Node addon failed to load

When the native addon cannot load in Node, the error names the platform package it tried, such as `@siafoundation/sia-storage-linux-x64-gnu`, and includes the underlying reason, which is also attached as the error's `cause`. It previously suggested a package name that does not exist and dropped the reason, so a missing package and a binary that failed to load looked the same. A platform with no published addon gets its own message pointing to the browser build.

## 0.1.1 (2026-09-30)

### Features

#### Stream files through a service worker

`openStreams(sdk, credentials)` hands out URLs for an `Sdk`'s or a `SharedSdk`'s objects that a service worker answers with ranged reads. An `Sdk` takes `{ indexerUrl, appMeta }` and a `SharedSdk` takes `{ indexerUrl, seed }`, typed by which one you pass. Video and audio seek without loading the whole file, and `streams.download()` sends a file to the browser's download manager without holding it in memory. Where service workers are unavailable, the same calls read the object in the page.

The worker ships prebuilt as `sia-storage-sw.js`, with the WebAssembly inside it. Vite apps serve it with the `siaStorage()` plugin from `@siafoundation/sia-storage/vite`, which also excludes the SDK from dependency pre-bundling. Next.js apps export `GET` from `@siafoundation/sia-storage/next` in `app/sia-storage-sw.js/route.ts`. Other setups copy it with `sia-storage-worker <dir>`. A site with its own service worker calls `installStreams(self)` from `@siafoundation/sia-storage/stream-worker` in it.

`detectPrivateRelay()` resolves whether a Safari visitor is on iCloud Private Relay, which the SDK does not work through.

### Fixes

- Update sia-sdk-rs (napi v0.10.1, wasm v0.7.0)

## 0.1.0 (2026-09-15)

### Breaking Changes

#### Update sia-sdk-rs (napi v0.10.0, wasm v0.6.0)

Adds sharing keys to the wrapper's public surface, exporting `SharingKey`, `KeyRecord`, and `SharedSdk` from both the browser and Node entry points along with the `KeyStats` type. The release also renames `Sdk.shareObject` and `Sdk.sharedObject` to `Sdk.objectShareUrl` and `Sdk.objectFromShareUrl`, since `shareObject` now attaches an object to a sharing key. `Builder` gains `connectPreAuthorized`, `reconnecting`, and `matchesExistingAppKey`, and `PinnedObject` gains `truncate`.

## 0.0.14 (2026-08-10)

### Fixes

- Update sia-sdk-rs (napi v0.9.0, wasm v0.5.0)

## 0.0.13 (2026-06-26)

### Fixes

- Update sia-sdk-rs (napi v0.8.0, wasm v0.4.0)

## 0.0.12 (2026-05-20)

### Fixes

- Compile WASM with SIMD support.

## 0.0.11 (2026-05-19)

### Fixes

#### Update sia-sdk-rs to napi v0.7.2, wasm v0.3.2

First published npm release built from tagged sia-sdk-rs versions
(previously the build cloned master).

## 0.0.10 (2026-05-13)

### Fixes

- Fix conditional exports so TypeScript declarations match the loaded runtime

## 0.0.9 (2026-04-29)

### Fixes

- Pull in latest Rust SDK

## 0.0.8 (2026-04-18)

### Fixes

- Publish via OIDC trusted publisher with build provenance

## 0.0.7 (2026-04-18)

### Features

- Test release flow
