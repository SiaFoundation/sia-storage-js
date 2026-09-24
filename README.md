# sia-storage-js

TypeScript SDK for building decentralized storage apps on the [Sia](https://sia.tech) network. Works in Node.js, Bun, and the browser.

For React Native, see [react-native-sia](https://github.com/SiaFoundation/react-native-sia).

## Install

```bash
npm install @siafoundation/sia-storage
```

## Quick start

```ts
import { initSia, Builder, generateRecoveryPhrase } from '@siafoundation/sia-storage'

await initSia()

const appMeta = {
  appId: '0'.repeat(64),                // 32-byte app identifier (hex)
  name: 'My App',
  description: 'An app on the Sia network',
  serviceUrl: 'https://myapp.com',
}

const builder = new Builder('https://sia.storage', appMeta)
await builder.requestConnection()
// Show builder.responseUrl() to the user — they visit it to authorize.
await builder.waitForApproval()

const phrase = generateRecoveryPhrase()
const sdk = await builder.register(phrase)

// Persist the app key so the user doesn't re-auth next time.
const appKeyHex = sdk.appKey().export().toHex()
```

Reconnecting a returning user:

```ts
import { Builder, AppKey } from '@siafoundation/sia-storage'

const sdk = await new Builder('https://sia.storage', appMeta)
  .connected(new AppKey(Uint8Array.fromHex(appKeyHex)))
```

## Uploading

```ts
import { PinnedObject } from '@siafoundation/sia-storage'

const object = await sdk.upload(new PinnedObject(), file.stream(), { maxInflight: 10 })
await sdk.pinObject(object)
```

Downloading:

```ts
const stream = sdk.download(object)
for await (const chunk of stream) { /* ... */ }
```

For many small files, share slabs via `uploadPacked`:

```ts
const packed = sdk.uploadPacked({ maxInflight: 10 })
await packed.add(fileA.stream())
await packed.add(fileB.stream())
for (const obj of await packed.finalize()) await sdk.pinObject(obj)
```

## Streaming files

Play video and audio without loading the whole file first, and save large files without holding them in memory. A service worker reads each object in ranges and answers the page with an ordinary URL, so `<video>` seeks on its own and a download goes to the browser's download manager. Where service workers are unavailable, the same calls read the object in the page instead, so the code is the same everywhere.

```ts
import { openStreams } from '@siafoundation/sia-storage'

// An Sdk, with the indexer URL and app metadata its Builder was made with.
const streams = openStreams(sdk, { indexerUrl, appMeta })

// Or a SharedSdk, with the indexer URL and seed it was connected with.
const sharedStreams = openStreams(sharedSdk, { indexerUrl, seed })

// Any element or fetch that takes a URL.
const video = await streams.url(object, { name: 'clip.mp4', type: 'video/mp4' })
videoElement.src = video.url
// When the element goes away:
video.release()

// From a click handler, so the browser allows the save.
button.onclick = () => streams.download(object, { name: 'clip.mp4' })

// When you're done with the SDK:
streams.close()
```

### Serve the worker

The worker is one file, `sia-storage-sw.js`, served from your site's root. Use the line for your setup.

**Vite** (React, Vue, Svelte, Solid and others): add the plugin. It serves the worker in `vite dev`, emits it with the build, and excludes the SDK from dependency pre-bundling.

```js
// vite.config.js
import { siaStorage } from '@siafoundation/sia-storage/vite'

export default defineConfig({ plugins: [siaStorage()] })
```

**Next.js (App Router)**: add one route file.

```ts
// app/sia-storage-sw.js/route.ts
export { GET } from '@siafoundation/sia-storage/next'
export const dynamic = 'force-static'
```

**Anything else** (webpack, Rollup, esbuild, Parcel, the Next.js Pages Router, a static host): copy the worker into the folder served at your site's root. The file changes with each SDK version, so copy it on every install and leave it out of git.

```json
// package.json
"scripts": { "postinstall": "sia-storage-worker public" }
```

### Good to know

- **HTTPS or localhost.** Browsers only run service workers there. Anywhere else the page reads objects itself.
- **A site served from a sub-path**, such as `/app/`, serves the worker there too and says where, before the first `openStreams`: `enableStreaming({ workerUrl: '/app/sia-storage-sw.js' })`.
- **A site with its own service worker** can't add a second one, since a page has only one. Call `installStreams(self)` from `@siafoundation/sia-storage/stream-worker` inside yours, and point `enableStreaming` at it: `enableStreaming({ workerUrl: '/sw.js', type: 'module' })`.
- **A Content Security Policy** needs `worker-src 'self'`.
- **The credentials stay in memory.** The worker connects its own SDK, so it needs what yours was made with: a `SharedSdk`'s seed, or an `Sdk`'s app key, which it takes from `sdk.appKey()`. The page hands them over a message port, and the worker never writes them anywhere.
- **Keep the tab open** until a download finishes. If the browser restarts the worker, it gets the credentials back from the page.
- **The first download click** within a few seconds of `openStreams`, before the worker is ready, uses the save picker or an in-memory save instead.

## iCloud Private Relay

The SDK does not work through iCloud Private Relay. `detectPrivateRelay()` resolves true for a Safari visitor on it, so you can ask them to turn it off in iCloud settings. Other browsers resolve false without a request.

```ts
import { detectPrivateRelay } from '@siafoundation/sia-storage'

if (await detectPrivateRelay()) showRelayNotice()
```

## Framework notes

The browser build is WebAssembly — most bundlers handle it directly, a few need a small hint.

**Vite**: the `siaStorage()` plugin from [Serve the worker](#serve-the-worker) covers this. Without it, production builds work as-is, and `vite dev` needs the package excluded from the dep pre-bundler so its `import.meta.url`-relative WASM path resolves correctly:

```js
// vite.config.js
export default defineConfig({
  optimizeDeps: { exclude: ['@siafoundation/sia-storage'] },
})
```

Without this, the dev server fetches the `.wasm` from `/node_modules/.vite/deps/` where it doesn't exist, the SPA fallback returns `index.html`, and `WebAssembly.instantiate` fails with a `magic word … found 3c 21 64 6f` error.

**Next.js (App Router)** — load from a Client Component, dynamically imported so the WebAssembly module isn't pulled into the server prerender:

```tsx
'use client'
import dynamic from 'next/dynamic'
const Storage = dynamic(() => import('./storage'), { ssr: false })
export default function Page() { return <Storage /> }
```

**Webpack**:

```js
// webpack.config.js
module.exports = { experiments: { asyncWebAssembly: true, topLevelAwait: true } }
```

**Rollup / esbuild** — copy the WebAssembly asset into your output directory:

```bash
cp node_modules/@siafoundation/sia-storage/wasm/sia_storage_wasm_bg.wasm dist/
```

## Node vs browser

Near-identical surfaces. Real differences:

- App identifier: `appMeta.appId: string (hex)` on browser, `appMeta.id: Buffer(32)` on Node.
- Numeric sizes are `number` on browser, `bigint` on Node. Byte arrays are `Uint8Array` on browser, `Buffer` on Node (`Buffer` is a `Uint8Array` subclass; both accept either as input).
- Sharing key seeds are hex `string` on browser, `Buffer` on Node. This covers `SharingKey.seed()`, `SharingKey.fromSeed(seed)`, and `SharedSdk.connect(indexerUrl, seed)`.
- `sdk.unshareObject(key, object)` takes a `PinnedObject` on browser and an object id `string` on Node.
- `sdk.hosts(query?)` and `sharedSdk.hosts(query?)` accept a `HostQuery` on browser; on Node they take no arguments.
- `openStreams` gives a browser page URLs that a service worker serves. Node reads objects with `sdk.download(object, { offset, length })`, which already streams a range, so it needs no worker. On Node, `enableStreaming()` resolves false, and `url` and `download` on an `openStreams` handle reject.

## API

### Top-level

| | |
|---|---|
| `initSia()` | Initialize. Call once before using the SDK. |
| `generateRecoveryPhrase()` | 12-word BIP-39 phrase. |
| `validateRecoveryPhrase(phrase)` | Throws on invalid. |
| `setLogger(callback, level)` | Receive SDK logs. |
| `encodedSize(size, dataShards, parityShards)` | Encoded size after erasure coding. |
| `detectPrivateRelay()` | Whether a Safari visitor is on iCloud Private Relay, which the SDK does not work through. |

### `Sdk`

Returned from `Builder.register()`, `Builder.connected()`, or `Builder.connectPreAuthorized()`.

| | |
|---|---|
| `appKey()` | The `AppKey` for this session. |
| `upload(object, stream, options?)` | Upload from a `ReadableStream`. Progress via `options.onShardUploaded`. |
| `download(object, options?)` | Returns a `ReadableStream`. Progress via `options.onShardDownloaded`. |
| `uploadPacked(options?)` | `PackedUpload` for batching small files into shared slabs. |
| `object(key)` / `deleteObject(key)` / `pinObject(object)` | Object CRUD. |
| `updateObjectMetadata(object)` | Push local metadata changes to the indexer. |
| `objectShareUrl(object, validUntil)` / `objectFromShareUrl(url)` | Create / consume share URLs. |
| `objectEvents(cursor?, limit)` | Paginated change feed. |
| `hosts(query?)` / `slab(id)` / `account()` / `pruneSlabs()` | Indexer reads. |
| `createSharingKey(description, expiresAt?)` | Create a `SharingKey` for read-only sharing. |
| `sharingKeys(offset, limit)` / `sharingKey(key)` | List keys / fetch one key's `KeyRecord`. |
| `shareObject(key, object)` / `unshareObject(key, object)` | Attach / detach an object on a sharing key. |
| `sharedObjects(key, offset, limit)` | Objects attached to a sharing key. |
| `revokeSharingKey(key)` | Delete the key and detach all of its objects. |

### `Builder`

`new Builder(indexerUrl, appMeta)`

| | |
|---|---|
| `requestConnection()` | Start the approval flow. |
| `responseUrl()` | URL to show the user. |
| `waitForApproval()` | Resolves once the user approves. |
| `register(phrase)` | Finish onboarding with a new recovery phrase → `Sdk`. |
| `connected(appKey)` | Reconnect with a saved `AppKey` → `Sdk \| null`. |
| `reconnecting()` | Whether the approved connect key already has an account. |
| `matchesExistingAppKey(phrase)` | Whether a phrase derives an already-registered app key. |
| `connectPreAuthorized(seed, phrase)` | Skip the approval flow with a pre-authorized key's 32-byte seed → `Sdk`. |

### `AppKey`

`new AppKey(seed)` — 32-byte `Uint8Array`.

`publicKey()` · `sign(message)` · `verifySignature(message, signature)` · `export()`

### `PinnedObject`

`new PinnedObject()` for new uploads, or `sdk.object(key)`.

`id()` · `size()` · `encodedSize()` · `slabs()` · `metadata()` · `updateMetadata(bytes)` · `truncate(length: bigint)` · `createdAt()` · `updatedAt()` · `seal(appKey)` · `PinnedObject.open(appKey, sealed)`

### `PackedUpload`

From `sdk.uploadPacked()`.

`add(stream)` · `finalize()` · `cancel()` · `remaining()` · `length()` · `slabs()`

### `SharingKey`

From `sdk.createSharingKey()`, or `SharingKey.fromSeed(seed)` to import one.

`publicKey` · `seed()` · `SharingKey.fromSeed(seed)`

### `KeyRecord`

The indexer's record for a sharing key, from `sdk.sharingKey()` or `sdk.sharingKeys()`.

`key` · `description` · `stats`

### `SharedSdk`

`SharedSdk.connect(indexerUrl, seed)` — read-only access for a recipient holding a
sharing key's seed. Downloads are paid for by the key's owner.

| | |
|---|---|
| `stats()` | The key's `KeyStats` snapshot. |
| `object(id)` / `objects(offset, limit)` | Read the objects the key grants access to. |
| `download(object, options?)` | Returns a `ReadableStream`. |
| `hosts(query?)` | Hosts serving this key's objects. |

### Streaming

| | |
|---|---|
| `openStreams(sdk, credentials)` | `Streams` for one SDK's objects. An `Sdk` takes `{ indexerUrl, appMeta }` and a `SharedSdk` takes `{ indexerUrl, seed }`, typed by which one you pass. |
| `streams.url(object, options)` | `{ url, blob?, release() }`. Streams where it can, else reads the whole object into `blob`. |
| `streams.download(object, options)` | Saves the object. Resolves `'streaming'`, `'saved'` or `'cancelled'`. Call it from a click handler. |
| `streams.close()` | Cancels this handle's streams. Other handles on the same SDK keep theirs. |
| `enableStreaming(options?)` | Registers the worker and resolves whether streaming is on. `openStreams` calls it for you, so call it only to pass `workerUrl`, `scope` or `type`. |

`options` for `url` and `download`: `name`, `type` (MIME), `onError(message)` for failures after streaming starts (logged when omitted), `onProgress(bytes)` when the page reads the object itself, and `signal` for `url`.

### `@siafoundation/sia-storage/stream-worker`

`installStreams(self, { wasm? })` adds streaming to a service worker of your own. `wasm` is the SDK's WebAssembly as a URL, bytes or module, for bundlers that don't emit it.

## License

MIT
