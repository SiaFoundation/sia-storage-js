# sia-storage

TypeScript SDK for building decentralized storage apps on the [Sia](https://sia.tech) network.

Works in Node.js, Bun, and the browser. Install picks the right platform binary (native on Node/Bun, WASM on browser) — no bundler config needed in Vite, Next.js, webpack, esbuild, or Rollup.

## Install

```bash
npm install sia-storage
```

## Quick start

```ts
import { initSia, Builder, generateRecoveryPhrase } from 'sia-storage'

await initSia()

const builder = new Builder('https://sia.storage', appMeta)
await builder.requestConnection()
// show builder.responseUrl() to the user — they visit it to authorize
await builder.waitForApproval()

const phrase = generateRecoveryPhrase() // show to user once, they save it
const sdk = await builder.register(phrase)

// persist this so the user doesn't re-auth next time
const appKeyHex = sdk.appKey().export().toHex()
```

Reconnecting a returning user:

```ts
import { connect, AppKey } from 'sia-storage'
const sdk = await connect('https://sia.storage', appMeta, new AppKey(Uint8Array.fromHex(appKeyHex)))
```

## Uploading a file

```ts
import { PinnedObject } from 'sia-storage'

const file = /* File | Blob | any source with a .stream() */
const object = await sdk.upload(new PinnedObject(), file.stream(), { maxInflight: 10 })
await sdk.pinObject(object)
```

Downloading it back:

```ts
const stream = sdk.download(object)
for await (const chunk of stream) { /* ... */ }
```

Many small files — pack them into shared slabs:

```ts
const packed = await sdk.uploadPacked({ maxInflight: 10 })
await packed.add(fileA.stream())
await packed.add(fileB.stream())
for (const obj of await packed.finalize()) await sdk.pinObject(obj)
```

## API

### Top-level

| | |
|---|---|
| `initSia()` | Initialize. Call once before using the SDK. |
| `connect(indexerUrl, appMeta, appKey)` | Reconnect a returning user. |
| `generateRecoveryPhrase()` | 12-word BIP-39 phrase. |
| `validateRecoveryPhrase(phrase)` | Throws on invalid. |
| `setLogger(callback, level)` | Forward SDK logs (callback ignored in browser; use `setLogLevel` there). |
| `encodedSize(size, dataShards, parityShards)` | Encoded size after erasure coding. |

### `Sdk`

From `connect()`, `Builder.register()`, or `Builder.connected()`.

| | |
|---|---|
| `appKey()` | The `AppKey` for this session. |
| `upload(object, stream, options, progressFn?)` | Upload. Takes a `ReadableStream`. |
| `download(object, options?)` | Returns a `ReadableStream`. |
| `uploadPacked(options, progressFn?)` | Returns a `PackedUpload` for batching small files. |
| `object(key)` / `deleteObject(key)` / `pinObject(obj)` | Object CRUD. |
| `updateObjectMetadata(obj)` | Sync metadata to the indexer. |
| `shareObject(obj, validUntil)` / `sharedObject(url)` | Create / consume share URLs. |
| `objectEvents(cursor?, limit)` | Paginated event stream. |
| `hosts()` / `slab(id)` / `account()` / `pruneSlabs()` | Indexer reads. |

### `Builder`

`new Builder(indexerUrl, appMeta)`

| | |
|---|---|
| `requestConnection()` | Start the approval flow. |
| `responseUrl()` | URL to show the user. |
| `waitForApproval()` | Resolves once the user approves. |
| `register(phrase)` | Finish with a new recovery phrase → `Sdk`. |
| `connected(appKey)` | Reconnect with a saved `AppKey` → `Sdk \| null`. |

### `AppKey`

`new AppKey(seed: Uint8Array)` — 32-byte seed.

`publicKey()` · `sign(msg)` · `verifySignature(msg, sig)` · `export()`

### `PinnedObject`

`new PinnedObject()` for new uploads, or `sdk.object(key)`.

`id()` · `size()` · `encodedSize()` · `slabs()` · `metadata()` · `updateMetadata(bytes)` · `createdAt()` · `updatedAt()` · `seal(appKey)` · `PinnedObject.open(appKey, sealed)`

### `PackedUpload`

From `sdk.uploadPacked()`.

`add(stream)` · `finalize()` · `cancel()` · `remaining()` · `length()` · `slabs()`

## Node vs browser — small differences

Re-exports the Sia SDK's native-NAPI bindings in Node/Bun and its WASM bindings in the browser. Near-identical surfaces; two places they diverge:

- **App metadata:** Node uses `{ id: Buffer(32), ... }`; browser uses `{ appId: string (hex), ... }`. Browser can't use fixed-size Buffers.
- **Logging:** Node accepts a callback via `setLogger(cb, level)`; browser only has `setLogLevel(level)` — log messages go to `console.log`.

Byte arrays and numeric types also differ a bit — Node returns `Buffer` and `bigint` for sizes, browser returns `Uint8Array` and `number`. These are upstream binding differences, not this package.

## License

MIT
