# Development

Guide for maintainers of this package. You do **not** need any of this to use `@siafoundation/sia` as a dependency.

## Prerequisites

- [Bun](https://bun.sh)
- [Rust toolchain](https://rustup.rs) (only for rebuilding WASM or NAPI binaries)

## Setup

```bash
bun install
```

## Build

```bash
bun run build
```

## Test

```bash
bun test
```

## Rebuilding WASM from source

The `wasm/` directory contains pre-built artifacts checked into git. Rebuilding is only necessary if you modify the underlying [Rust SDK](https://github.com/SiaFoundation/sia-sdk-rs).

```bash
bun run setup         # Clone the Rust SDK (one-time)
bun run build-wasm    # Compile with wasm-pack
bun run build         # Build TypeScript + patch WASM glue
```

## Rebuilding NAPI binary from source

The NAPI binary is distributed as platform-specific npm packages. To build from source for testing:

```bash
bun run setup           # Clone Rust SDK (one-time, same as WASM)
bun run setup-napi-test # Build native addon for current platform
bun test                # Tests exercise the real NAPI binary
```

## Releasing

Releases are managed by [knope](https://knope.tech) and CI workflows.

1. `knope document-change` — create a changeset describing your change
2. Push to `main` — the `prepare-release` workflow bumps versions and opens a release PR
3. Merge the release PR — the `release` workflow builds NAPI binaries for all platforms, runs tests, and publishes to npm
