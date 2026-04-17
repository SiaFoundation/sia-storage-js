# Development

Maintainer guide. You do **not** need any of this to use `sia-storage` as a dependency.

## Prerequisites

- [Bun](https://bun.sh)
- [Rust toolchain](https://rustup.rs) (only when rebuilding WASM or NAPI binaries)

## Setup

```bash
bun install
bun run setup            # clones sia-sdk-rs master (no SHA pin — fresh each time)
```

## Build

```bash
bun run build            # runs build-wasm, then tsup
```

## Test

Three tiers, cheapest first:

```bash
bun run setup-napi-test  # build the NAPI binary for the current platform
bun run test             # pack + install into a temp dir, smoke-run in Node and Bun
bun run test:browser     # pack + install into a temp Vite app, smoke-run in Chromium
bun run test:all         # both integration tiers
```

The browser tier needs Playwright's Chromium:

```bash
bunx playwright install chromium
```

## Release flow

Managed by [Knope](https://knope.tech) + two GitHub Actions workflows.

**1. Every PR must include a changeset.** When you open a PR, add a file under `.changeset/` describing the change:

```bash
bunx knope document-change
```

This prompts for a change type (`major` / `minor` / `patch`) and a short description. Commit the generated `.changeset/<name>.md` with your PR.

**2. On merge to main, a Release PR opens automatically.** The `prepare-release` workflow runs Knope, which:

- Scans `.changeset/` to compute the next version.
- Bumps `package.json` and all `optionalDependencies.sia-storage-*` entries in lockstep.
- Prepends a new section to `CHANGELOG.md` with each changeset's description.
- Commits to the `release` branch and opens a "chore: prepare release" PR.

You can accumulate multiple changesets on main — each subsequent merge updates the open Release PR with the combined changes.

**3. Merging the Release PR publishes.** The `release` workflow fires on the Release PR merge:

- Builds the NAPI binary for all five platforms.
- Builds the WASM bundle.
- Runs the full test suite (unit + Node integration + browser integration).
- Publishes the six npm packages (`sia-storage` + five `sia-storage-<platform>`).
- Creates a git tag and GitHub release with the changelog entry.

### Manual release

`Actions → Release → Run workflow` also publishes. Use this to force a republish at the current version — it skips the Knope changelog step but goes through the full build + publish path.

### Secrets required

- `NPM_TOKEN` — npm token with publish rights on all six package names.
- `GITHUB_TOKEN` — built-in, used by Knope to create tags and releases.

**Gotcha:** PRs opened by `GITHUB_TOKEN` don't trigger other workflows. The Release PR created by `prepare-release` won't auto-run CI. Close and reopen it to kick off a CI run, or add a `PAT` secret and switch `peter-evans/create-pull-request` to use it.

## Updating the upstream Rust SDK

There's nothing to do — `scripts/setup-rust.ts` and the CI jobs clone `sia-sdk-rs` master directly. Trigger a release (or any build) to pick up the latest upstream.

If you need to pin to a specific commit (say, to diagnose a regression), edit `SIA_SDK_RS_BRANCH` in `scripts/setup-rust.ts` and the clone command in `.github/workflows/release.yml`.
