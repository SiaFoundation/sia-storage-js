# Sweetest fork of the Sia storage SDK

This is `SiaFoundation/sia-storage-js` at `v0.2.0`, forked so Sweetest can change the upload
control flow without waiting on upstream. The Rust core is a second fork,
`sweetest-app/sia-sdk-rs`, pinned here as a submodule at `rust/sia-sdk-rs`.

## What is different from upstream

Only the files listed here. Everything else is upstream as released.

| Commit | Change |
| --- | --- |
| fork setup | `.gitignore` keeps `dist/` and `wasm/` tracked, `rust/sia-sdk-rs` is a submodule, `CHECKSUMS.txt` added |
| `03293b8` (core) | `PackedUpload::finalize` borrows instead of consuming, so `cancel()` still works while it runs |
| `db119d4` (core) | `onShardAttempted` reports every shard write attempt, failures included, with the host and the reason |
| `45dbb8c` (core) | `onShardAttempted` typed in the options interfaces, so the callback is visible to TypeScript |
| wrapper | `UploadCancelled` and `finalizePacked(packed, { signal })`; `build-wasm` builds the patched submodule instead of a clone at the tag |

The patches below are in. `finalizePacked` is the app-facing way to start a packed upload and
stop it later.

## Why the artifacts are committed

Sweetest installs this repo by git tag, so a machine that runs the app must not need a Rust
toolchain. `dist/`, `wasm/`, and the native binding built into
`node_modules/@siafoundation/sia-storage-<platform>` at build time are produced here and
committed. `CHECKSUMS.txt` names the core commit and the checksums of the files that matter, so
a stale artifact is visible instead of silent.

Rebuilding is a three step job, and it needs `cargo`, `wasm-pack`, and `@napi-rs/cli`:

```bash
bun run setup
bun run build-wasm
bun run setup-napi-test
bun run build
shasum -a 256 wasm/sia_storage_wasm_bg.wasm dist/index.js dist/index.node.cjs
```

`cargo` and `rustc` are not on `PATH` on the Sweetest dev machine. Use the toolchain directly:

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
```

## Test status on the Sweetest dev machine

The upstream suite is 251 tests. On this machine, with no source changes:

| Group | Result |
| --- | --- |
| Node tests (`native-addon`, `publish-manifest`, `relay`, `install-integration`) | 24 pass, 0 fail |
| Chromium streaming and worker tests | all pass |
| Firefox | cannot launch at all here: `firefox.launch()` times out after 120 s with "Failed to launch the browser process" |
| WebKit | launches and loads pages, but the service-worker streaming tests hang at 60 s |
| Bundler integration (`esbuild`, `vite`, `rollup`, `webpack`, `next`) | hook times out at 180 s; the hook installs a tarball and smoke-tests all three engines, and the Firefox launch alone spends the budget |

So the gate for any patch in this fork is: Node tests pass, Chromium tests pass, and the
Sweetest live browser test passes. Firefox and WebKit are recorded as environment-limited, not
as passing.

## Patch rules

- One commit per change, each with its own test.
- Never touch encryption, erasure coding, key handling, or slab layout.
- Rebase on the upstream tag instead of merging upstream into the patch branch.
- Every patch is proposed upstream, and leaves this fork once merged.
