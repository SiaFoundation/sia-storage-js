---
default: minor
---

#### Update sia-sdk-rs (napi v0.11.1, wasm v0.8.1)

Adds `SharedSdk.objectSummaries(offset, limit)` and the `ObjectSummary` it returns, which lists a sharing key's objects without their slabs. Removes `Sdk.slab(id)` and the `PinnedSlab` type, which the SDK dropped because no binding could produce a slab id. `Sdk.pruneSlabs` now takes an optional `before` cutoff.
