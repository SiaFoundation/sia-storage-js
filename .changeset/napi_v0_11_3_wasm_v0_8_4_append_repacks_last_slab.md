---
default: patch
---

# Update sia-sdk-rs (napi v0.11.3, wasm v0.8.4): appending repacks the last slab efficiently

Appending data to an object now efficiently repacks the object's last slab when it is
not full, instead of leaving it partly empty, and an append of zero bytes returns the
object unmodified.
