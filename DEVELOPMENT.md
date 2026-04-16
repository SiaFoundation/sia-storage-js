# Development

Maintainer guide. You do **not** need any of this to use `sia-storage` as a dependency.

## Prerequisites

- [Bun](https://bun.sh)
- [Rust toolchain](https://rustup.rs) (only when rebuilding WASM or NAPI binaries)

## Setup

```bash
bun install
bun run setup            # clones Rust SDK at pinned SHA (see scripts/setup-rust.ts)
```

## Build

```bash
bun run build            # runs build-wasm, then tsup
```

## Test

Three tiers, cheapest first:

```bash
bun run test                    # unit tests for utilities (toHex, decodeMetadata, etc.)
bun run setup-napi-test         # build the NAPI binary for the current platform
bun run test:integration        # pack + install into a temp dir, smoke-run in Node and Bun
bun run test:browser-integration # pack + install into a temp Vite app, smoke-run in Chromium
bun run test:all                # all of the above
```

The browser tier needs Playwright's Chromium:

```bash
bunx playwright install chromium
```

## Releasing

Triggered manually from the Actions tab on GitHub — **Actions → Release → Run workflow**.

1. Bump `version` and all `optionalDependencies.sia-storage-*` entries in `package.json` on `main`.
2. Trigger the **Release** workflow.
3. It builds the NAPI binary for all five platforms, builds the WASM bundle, runs the full test suite, then publishes the six npm packages (`sia-storage` + five platform packages).

`NPM_TOKEN` must be configured as a repo secret.

## Updating the upstream Rust SDK

The Rust source is pinned by SHA in `scripts/setup-rust.ts` and mirrored in `.github/workflows/release.yml` as the `SIA_SDK_RS_SHA` env var. To bump:

1. Update `SIA_SDK_RS_SHA` in both places.
2. Delete `rust/sia-sdk-rs/` and rerun `bun run setup`.
3. Rebuild and run `bun run test:all`.
