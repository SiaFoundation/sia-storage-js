---
default: minor
---

#### Update sia-sdk-rs (napi v0.11.0, wasm v0.8.0)

Adds `sharedSdk.objectSummaries(offset, limit)`, which lists a sharing key's objects without their slabs, along with the `ObjectSummary` type it returns. The builder gains `withCbor(enable)` and `SharedSdk` gains `connectWithCbor(indexerUrl, seed, cbor)` for requesting JSON instead of CBOR from the indexer. `sdk.pruneSlabs()` now takes an optional `before` cutoff. `sdk.slab(id)` and the `PinnedSlab` type are removed upstream and no longer exported, and `encodedSize` now throws when data shards is zero rather than aborting the process.
