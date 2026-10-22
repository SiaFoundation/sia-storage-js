---
default: minor
---

#### Update sia-sdk-rs (napi v0.11.1, wasm v0.8.3)

The WASM pin moves to v0.8.3, which adds `Sdk.objectEventSummaries` and the
`ObjectEventSummary` class, now exported from the browser entry. It also closes
WebTransport streams whose open was abandoned and stops redialing hosts that
refused a handshake. The NAPI pin stays at v0.11.1 because v0.11.2 was not
released on the commit this release tagged, so `objectEventSummaries` is
unavailable on Node until that pin moves.
