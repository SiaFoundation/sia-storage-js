---
default: minor
---

#### Stream files through a service worker

`openStreams(sdk, credentials)` hands out URLs for an `Sdk`'s or a `SharedSdk`'s objects that a service worker answers with ranged reads. An `Sdk` takes `{ indexerUrl, appMeta }` and a `SharedSdk` takes `{ indexerUrl, seed }`, typed by which one you pass. Video and audio seek without loading the whole file, and `streams.download()` sends a file to the browser's download manager without holding it in memory. Where service workers are unavailable, the same calls read the object in the page.

The worker ships prebuilt as `sia-storage-sw.js`, with the WebAssembly inside it. Vite apps serve it with the `siaStorage()` plugin from `@siafoundation/sia-storage/vite`, which also excludes the SDK from dependency pre-bundling. Next.js apps export `GET` from `@siafoundation/sia-storage/next` in `app/sia-storage-sw.js/route.ts`. Other setups copy it with `sia-storage-worker <dir>`. A site with its own service worker calls `installStreams(self)` from `@siafoundation/sia-storage/stream-worker` in it.

`detectPrivateRelay()` resolves whether a Safari visitor is on iCloud Private Relay, which the SDK does not work through.
