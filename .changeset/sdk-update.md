---
default: minor
---

#### Update sia-sdk-rs (napi v0.10.0, wasm v0.6.0)

Adds sharing keys to the wrapper's public surface, exporting `SharingKey`, `KeyRecord`, and `SharedSdk` from both the browser and Node entry points along with the `KeyStats` type. The release also renames `Sdk.shareObject` and `Sdk.sharedObject` to `Sdk.objectShareUrl` and `Sdk.objectFromShareUrl`, since `shareObject` now attaches an object to a sharing key. `Builder` gains `connectPreAuthorized`, `reconnecting`, and `matchesExistingAppKey`, and `PinnedObject` gains `truncate`.
