# @siafoundation/sia

TypeScript SDK for building decentralized storage apps on the [Sia](https://sia.tech) network.

## Install

```bash
npm install @siafoundation/sia
```

## Environment support

### Browser (Vite, Next.js, webpack)

Uses WebAssembly + WebTransport. Requires bundler configuration (see below).

### Node.js / Bun

Uses a native addon (NAPI). No bundler setup required — just install and import.
The correct binary for your platform is installed automatically.

## Browser bundler setup

> This section only applies to browser usage. Node.js/Bun users skip this entirely.

### Vite

```bash
npm install vite-plugin-wasm vite-plugin-top-level-await
```

```ts
// vite.config.ts
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ['@siafoundation/sia'],
  },
  resolve: {
    alias: {
      'sia-wasm': '@siafoundation/sia/wasm',
    },
  },
})
```

### Next.js

```ts
// next.config.ts
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias['sia-wasm'] = require.resolve('@siafoundation/sia/wasm')
    config.experiments = { ...config.experiments, asyncWebAssembly: true }
    return config
  },
}
export default nextConfig
```

### TypeScript

Add to your `tsconfig.json` so the `sia-wasm` alias resolves types:

```json
{
  "compilerOptions": {
    "paths": {
      "sia-wasm": ["./node_modules/@siafoundation/sia/wasm/sia.d.ts"]
    }
  }
}
```

## Usage

### Initialize

Call `initSia()` once before using any other SDK functions. In the browser this loads the WASM module; in Node.js it validates the native addon.

```ts
import { initSia } from '@siafoundation/sia'

await initSia()
```

### Authentication

Authentication is a two-phase flow: first connect your app to an indexer, then register with a recovery phrase. On subsequent visits, reconnect using the stored app key.

#### New user

```ts
import {
  Builder,
  SiaClient,
  generateRecoveryPhrase,
  toHex,
} from '@siafoundation/sia'

const indexerUrl = 'https://app.sia.storage'

// 1. Request a connection from the indexer
const builder = new Builder(indexerUrl)

await builder.requestConnection(JSON.stringify({
  appID: appKeyHex,       // 32-byte hex app identifier
  name: 'My App',
  description: 'A decentralized storage app',
  serviceURL: 'https://myapp.com',
}))

// 2. Direct the user to approve the connection
const approvalUrl = builder.responseUrl()
// Show this URL to the user — they visit it to authorize your app

// 3. Wait for the user to approve
await builder.waitForApproval()

// 4. Register with a recovery phrase to get an authenticated SDK
const phrase = generateRecoveryPhrase()
// Display the phrase for the user to save
const sdk = await builder.register(phrase)

// 5. Wrap in a SiaClient for upload/download
const client = new SiaClient(sdk, indexerUrl)

// 6. Export and persist the app key for reconnection
const appKey = sdk.appKey()
const keyHex = toHex(appKey.export())
// Store keyHex in localStorage or similar
```

> **CORS fallback**: If `requestConnection` fails due to CORS, you can have the user run the POST manually (e.g. via curl) and pass the response to `builder.setConnectionResponse(appKeyHex, responseJson)`.

#### Returning user

On subsequent visits, reconnect using the stored app key — no approval or recovery phrase needed:

```ts
import { connect, AppKey, fromHex } from '@siafoundation/sia'

const appKey = new AppKey(fromHex(storedKeyHex))
const client = await connect('https://app.sia.storage', appKey)
// Returns a SiaClient if recognized, or null if the key is unknown
```

### Upload

The `upload` function splits a file into slabs and uploads them in parallel. In the browser this uses Web Workers; in Node.js parallelism is handled natively by the Rust runtime.

```ts
import { upload } from '@siafoundation/sia'

const object = await upload(client, file, (progress) => {
  console.log(`${progress.phase}: ${progress.slabsComplete}/${progress.slabsTotal} slabs`)
})

// Pin the object to the indexer so it persists
await client.sdk.pinObject(object)
```

For smaller files, you can also upload directly on the main thread without workers:

```ts
import { UploadOptions } from '@siafoundation/sia'

const data = new Uint8Array(await file.arrayBuffer())
const opts = new UploadOptions()
const object = await client.sdk.upload(data, opts, (current, total) => {
  console.log(`${current}/${total} shards`)
})
await client.sdk.pinObject(object)
```

### Download

```ts
import { download } from '@siafoundation/sia'

const data = await download(client, object, (progress) => {
  console.log(`${progress.phase}: ${progress.bytesComplete}/${progress.bytesTotal} bytes`)
})

// data is a Uint8Array of the decrypted file contents
```

For partial reads (e.g. video seeking), use a range download — only the overlapping slabs are fetched:

```ts
const chunk = await download(client, object, onProgress, {
  range: { offset: 0, length: 1024 * 1024 }, // first 1 MB
})
```

### Metadata

Attach and read metadata on objects:

```ts
// Write metadata
const meta = new TextEncoder().encode(JSON.stringify({
  name: 'photo.jpg',
  type: 'image/jpeg',
  size: file.size,
}))
object.updateMetadata(meta)
await sdk.updateObjectMetadata(object)

// Read metadata
import { decodeMetadata } from '@siafoundation/sia'
const parsed = decodeMetadata(object.metadata())
```

### Sharing

```ts
// Create a share link valid for 24 hours
const shareUrl = client.sdk.shareObject(object, Date.now() + 86_400_000)

// Download a shared object
const shared = await client.sdk.sharedObject(shareUrl)
const data = await download(client, shared)
```

### Node.js / Bun

No bundler configuration is needed. The native addon loads automatically:

```ts
import { initSia, connect, upload, download, AppKey, fromHex } from '@siafoundation/sia'

await initSia()
const client = await connect('https://indexer.example.com', new AppKey(fromHex(keyHex)))
// upload/download work identically — no Web Workers, no bundler config needed
```

## API

### Top-level exports

| Export | Description |
|--------|-------------|
| `initSia()` | Initialize the SDK (loads WASM in browser, validates native addon in Node.js) |
| `SiaClient` | Wrapper that bundles an SDK instance with connection details |
| `connect(indexerUrl, appKey)` | Reconnect a returning user — returns `SiaClient \| null` |
| `upload(client, file, onProgress, numWorkers?)` | Parallel file upload (Web Workers in browser, native threads in Node.js) |
| `download(client, object, onProgress?, config?)` | Parallel download — full or range |
| `generateRecoveryPhrase()` | Generate a 12-word BIP-39 recovery phrase |
| `validateRecoveryPhrase(phrase)` | Validate a recovery phrase |
| `setLogLevel(level)` | Control log verbosity (`"debug"`, `"info"`, `"warn"`, `"error"`) |
| `toHex(bytes)` / `fromHex(hex)` | Convert between `Uint8Array` and hex strings |
| `decodeMetadata(bytes)` | Decode object metadata from bytes to JSON |

### SDK

Instance methods available on the `sdk` property of `SiaClient`.

| Method | Description |
|--------|-------------|
| `upload(data, options, onProgress)` | Upload a `Uint8Array` on the main thread |
| `download(object, options, onProgress)` | Download an object on the main thread |
| `downloadRange(object, offset, length, options, onSector)` | Download a byte range — only fetches overlapping slabs |
| `pinObject(object)` | Pin an object to the indexer so it persists |
| `deleteObject(key)` | Delete an object by its hex key |
| `object(key)` | Retrieve a pinned object by its hex key |
| `updateObjectMetadata(object)` | Update an object's metadata on the indexer |
| `shareObject(object, validUntilMs)` | Create a share URL valid until the given timestamp |
| `sharedObject(shareUrl)` | Retrieve a shared object from a share URL |
| `objectEvents(cursor?, limit)` | List object events for syncing (cursor-based pagination) |
| `hosts()` | Returns available hosts as a JSON array |
| `account()` | Returns account information |
| `pruneSlabs()` | Prune unused slabs from the indexer |
| `appKey()` | Returns the `AppKey` used by this SDK instance |
| `slabDataSize()` | Default slab data size in bytes |

### Builder

Connection builder — authenticate with an indexer.

| Method | Description |
|--------|-------------|
| `new Builder(indexerUrl)` | Create a builder for the given indexer URL |
| `requestConnection(appMetaJson)` | Request a new app connection with metadata |
| `responseUrl()` | Returns the URL the user must visit to authorize |
| `waitForApproval()` | Polls until the user approves the connection |
| `register(phrase)` | Register with a recovery phrase — returns an `SDK` |
| `connected(appKey)` | Reconnect with an existing `AppKey` — returns `SDK \| null` |
| `setConnectionResponse(appIdHex, json)` | Set a pre-fetched connection response (CORS fallback) |

### AppKey

Ed25519 app key for signing and authentication.

| Method | Description |
|--------|-------------|
| `new AppKey(key)` | Import from a 64-byte keypair or 32-byte seed |
| `publicKey()` | Returns the hex-encoded public key |
| `sign(message)` | Sign a message, returns 64-byte signature |
| `verifySignature(message, signature)` | Verify a signature against a message |
| `export()` | Export the full 64-byte ed25519 keypair |

### PinnedObject

An encrypted object stored on Sia.

| Method | Description |
|--------|-------------|
| `id()` | Returns the object's hex ID |
| `size()` | Total size in bytes |
| `slabCount()` | Number of slabs in the object |
| `slabs()` | Slab layout with offsets, lengths, and host keys |
| `slabLengths()` | Data length of each slab as an array |
| `metadata()` | Returns metadata as a `Uint8Array` |
| `updateMetadata(bytes)` | Update the object's metadata |
| `seal(appKey)` | Serialize for offline storage (returns JSON) |
| `PinnedObject.open(appKey, json)` | Deserialize a sealed object |

### Configuration

| Export | Description |
|--------|-------------|
| `UploadOptions` | Upload config — `dataShards`, `parityShards`, `maxInflight`, `slabDataSize()` |
| `DownloadOptions` | Download config — `maxInflight` |
| `DownloadConfig` | Parallel download config — `workers`, `range`, `maxInflight` |

## License

MIT
