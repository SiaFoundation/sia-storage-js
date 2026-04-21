# sia-storage

TypeScript SDK for building decentralized storage apps on the [Sia](https://sia.tech) network. Works in Node.js, Bun, and the browser.

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

## Framework notes

The browser build is WebAssembly — most bundlers handle it directly, a few need a small hint.

**Vite** — production builds work as-is. For `vite dev`, exclude the package from the dep pre-bundler so its `import.meta.url`-relative WASM path resolves correctly:

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

## API

### Top-level

| | |
|---|---|
| `initSia()` | Initialize. Call once before using the SDK. |
| `generateRecoveryPhrase()` | 12-word BIP-39 phrase. |
| `validateRecoveryPhrase(phrase)` | Throws on invalid. |
| `setLogger(callback, level)` | Receive SDK logs. |
| `encodedSize(size, dataShards, parityShards)` | Encoded size after erasure coding. |

### `Sdk`

Returned from `Builder.register()` or `Builder.connected()`.

| | |
|---|---|
| `appKey()` | The `AppKey` for this session. |
| `upload(object, stream, options?)` | Upload from a `ReadableStream`. Progress via `options.onShardUploaded`. |
| `download(object, options?)` | Returns a `ReadableStream`. Progress via `options.onShardDownloaded`. |
| `uploadPacked(options?)` | `PackedUpload` for batching small files into shared slabs. |
| `object(key)` / `deleteObject(key)` / `pinObject(object)` | Object CRUD. |
| `updateObjectMetadata(object)` | Push local metadata changes to the indexer. |
| `shareObject(object, validUntil)` / `sharedObject(url)` | Create / consume share URLs. |
| `objectEvents(cursor?, limit)` | Paginated change feed. |
| `hosts()` / `slab(id)` / `account()` / `pruneSlabs()` | Indexer reads. |

### `Builder`

`new Builder(indexerUrl, appMeta)`

| | |
|---|---|
| `requestConnection()` | Start the approval flow. |
| `responseUrl()` | URL to show the user. |
| `waitForApproval()` | Resolves once the user approves. |
| `register(phrase)` | Finish onboarding with a new recovery phrase → `Sdk`. |
| `connected(appKey)` | Reconnect with a saved `AppKey` → `Sdk \| null`. |

### `AppKey`

`new AppKey(seed)` — 32-byte `Uint8Array`.

`publicKey()` · `sign(message)` · `verifySignature(message, signature)` · `export()`

### `PinnedObject`

`new PinnedObject()` for new uploads, or `sdk.object(key)`.

`id()` · `size()` · `encodedSize()` · `slabs()` · `metadata()` · `updateMetadata(bytes)` · `createdAt()` · `updatedAt()` · `seal(appKey)` · `PinnedObject.open(appKey, sealed)`

### `PackedUpload`

From `sdk.uploadPacked()`.

`add(stream)` · `finalize()` · `cancel()` · `remaining()` · `length()` · `slabs()`

## License

MIT
