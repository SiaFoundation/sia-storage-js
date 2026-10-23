---
default: minor
---

#### Update sia-sdk-rs (napi v0.11.2, wasm v0.8.3)

Adds `Sdk.objectEventSummaries(cursor?, limit)` and the `ObjectEventSummary` class it
returns, which lists the same object events as `objectEvents` without the objects'
slabs, so the response is much smaller. Each event carries an `ObjectSummary`; fetch the
full object with `Sdk.object(id)` to download it. The release also fixes connecting to
hosts that announce an IPv6 address, a crash reading a slab whose sectors include a host
the SDK does not know, and account tokens expiring before a read reaches the host. In the browser, it also
closes WebTransport streams whose open was abandoned, which piled up until a host stopped
accepting new ones, and stops redialing hosts that refused a handshake, whose failures
made Chrome delay every new connection by up to a minute.
