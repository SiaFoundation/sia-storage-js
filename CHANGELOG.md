# Changelog
## 0.0.7 (2026-04-18)

### Features

- init

#### Integrate the official SiaFoundation/sia-sdk-rs

- Rust source now pulled from `sia-sdk-rs` master (NAPI + WASM bindings).
- Browser entry re-enabled via `sia_storage_wasm`; Node entry uses `sia_storage_napi` with per-platform optionalDependencies.
- Dropped the parallel upload/download client wrapper — the SDK handles concurrency internally.
- Native addon binary named `sia-storage.node` on all five platforms (`darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `linux-arm64-gnu`, `win32-x64-msvc`).
- Removed `toHex` / `fromHex` / `decodeMetadata` helpers in favor of native `Uint8Array.prototype.toHex()`, `Uint8Array.fromHex()`, and `JSON.parse(new TextDecoder().decode(bytes))`.
- Integration tests verify the published tarball imports + runs in Node, Bun, and a real Vite-built Chromium page.
