# Changelog
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
