# Development

Maintainer guide. You do **not** need any of this to use `sia-storage` as a dependency.

## Prerequisites

- [Bun](https://bun.sh)
- [Rust toolchain](https://rustup.rs) — only when rebuilding NAPI or WASM artifacts.

## Setup

```bash
bun install
bun run setup            # clones sia-sdk-rs (currently the alex/napi-typedef branch, see note below)
bun run setup-napi-test  # builds the NAPI binary for this platform; regenerates src/node/napi.generated.d.ts
```

> **Note:** `scripts/setup-rust.ts` currently pins the upstream branch to `alex/napi-typedef`, which enables `napi-derive`'s `type-def` feature so our build can emit a clean `.d.ts`. Once that branch merges to upstream master, change `SIA_SDK_RS_BRANCH` back to `'master'` in `scripts/setup-rust.ts` and in the two `Clone Rust SDK` steps in `.github/workflows/release.yml`.

## Build

```bash
bun run build
```

Three steps under the hood:

1. `build-wasm` — `wasm-pack build --target web --release` → `wasm/sia_storage_wasm*`.
2. `tsup` — `dist/index.js` (browser ESM + types) and `dist/index.node.cjs` (Node CJS).
3. `build-node-types` — assembles `dist/index.node.d.ts` from `src/node/napi.generated.d.ts` (skipping tsup's d.ts bundle for the node entry, which would otherwise dedupe class names with `$1` suffixes).

## Test

Two integration tiers. Both pack the published tarball into a temp dir, install it, and exercise the SDK end-to-end.

```bash
bun run test          # Node + Bun: pack, install, smoke-run each runtime
bun run test:browser  # Vite, esbuild, webpack, Rollup, Next.js: pack, install, build, drive Chromium
bun run test:all      # both
```

The browser tier needs Playwright's Chromium:

```bash
bunx playwright install chromium
```

## Release flow

Managed by [Knope](https://knope.tech) + two GitHub Actions workflows.

**1. PRs include a changeset.** Add a file under `.changeset/` describing the change:

```bash
bunx knope document-change
```

You'll be prompted for a change type (`major` / `minor` / `patch`) and a short description. Commit the generated `.changeset/<name>.md` with your PR.

**2. On merge to main, a Release PR opens.** The `prepare-release` workflow runs Knope, which:

- Computes the next version from the queued changesets.
- Bumps `package.json` and all `optionalDependencies.sia-storage-*` entries in lockstep.
- Prepends a section to `CHANGELOG.md`.
- Commits to the `release` branch and opens a "chore: prepare release" PR.

Multiple feature merges accumulate into the same open Release PR.

**3. Merging the Release PR publishes.** The `release` workflow:

- Builds the NAPI binary for all five platforms.
- Builds the WASM bundle.
- Runs the full test suite.
- Publishes six npm packages (`sia-storage` + five `sia-storage-<platform>`).
- Creates a git tag and GitHub release.

### Manual release

`Actions → Release → Run workflow` also publishes. Use this to force a republish at the current version — it skips the Knope changelog step but runs the full build + publish path.

### Secrets

- `NPM_TOKEN` — npm token with publish rights on all six package names.
- `PAT` — Personal Access Token with `contents: write` + `pull-requests: write` on this repo. Required so the bot-created Release PR can trigger the Release workflow when merged. Falls back to `GITHUB_TOKEN` if unset, but with that fallback you have to close+reopen the Release PR manually to kick off CI.
- `GITHUB_TOKEN` — built-in, used by `knope release` to tag and create the GitHub release.

## Updating the upstream Rust SDK

`scripts/setup-rust.ts` and CI both clone `sia-sdk-rs` from the branch named in `SIA_SDK_RS_BRANCH`. To pick up new upstream changes, just trigger a release (or any build) — the clone is fresh every time.

To pin a different branch or commit (e.g. for testing a feature, or diagnosing a regression), edit `SIA_SDK_RS_BRANCH` in `scripts/setup-rust.ts` and the two `Clone Rust SDK` steps in `.github/workflows/release.yml`.
