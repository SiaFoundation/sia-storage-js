---
default: minor
---

#### Update sia-sdk-rs (napi v0.11.1, wasm v0.8.1)

Adds `sharedSdk.objectSummaries(offset, limit)`, which lists a sharing key's objects without their slabs, along with the `ObjectSummary` type it returns. The SDK asks the indexer for CBOR responses and falls back to JSON. `sdk.pruneSlabs()` now takes an optional `before` cutoff. `sdk.slab(id)` and the `PinnedSlab` type are removed upstream and no longer exported, and `encodedSize` now throws when data shards is zero rather than aborting the process.
