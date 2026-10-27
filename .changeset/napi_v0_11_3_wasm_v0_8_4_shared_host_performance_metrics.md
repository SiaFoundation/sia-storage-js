---
default: minor
---

# Update sia-sdk-rs (napi v0.11.3, wasm v0.8.4): share host performance metrics

Host performance metrics and the price cache are now shared across all SDK instances.
An app that builds more than one `Sdk`, or an `Sdk` alongside a `SharedSdk`, no longer
has each one learn host speeds and prices on its own, so a later instance starts with
what the earlier ones measured.
