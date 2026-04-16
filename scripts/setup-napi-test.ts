#!/usr/bin/env bun
// Build the NAPI binary from rust/sia-sdk-rs/sia_storage_napi and install it
// into node_modules so the node entry point can load it during tests.
// Prerequisites: Rust toolchain, `bun run setup` already run.
import { $ } from 'bun'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const NAPI_CRATE_DIR = join(ROOT, 'rust', 'sia-sdk-rs', 'sia_storage_napi')

const platform = process.platform
const arch = process.arch
let suffix = `${platform}-${arch}`
if (platform === 'linux') suffix = `${platform}-${arch}-gnu`
else if (platform === 'win32') suffix = `${platform}-${arch}-msvc`

const pkgName = `sia-storage-${suffix}`
const pkgDir = join(ROOT, 'node_modules', pkgName)
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
  .version

// Upstream's napi-rs config sets binaryName: "sia-storage", so the build
// emits sia-storage.${platform}-${arch}.node. We keep this naming end-to-end.
const binaryName = `sia-storage.${platform}-${arch}.node`
const builtBinary = join(NAPI_CRATE_DIR, binaryName)

// Skip if already installed.
if (existsSync(join(pkgDir, 'sia-storage.node'))) {
  console.log(`${pkgName} already installed, skipping build`)
  process.exit(0)
}

if (!existsSync(NAPI_CRATE_DIR)) {
  console.error(`sia_storage_napi crate not found at ${NAPI_CRATE_DIR}`)
  console.error("Run 'bun run setup' first to clone sia-sdk-rs.")
  process.exit(1)
}

if (!existsSync(builtBinary)) {
  console.log(`Building NAPI binary in ${NAPI_CRATE_DIR}...`)
  await $`bunx @napi-rs/cli build --release --platform`.cwd(NAPI_CRATE_DIR)
}

if (!existsSync(builtBinary)) {
  console.error(`Build did not produce ${builtBinary}`)
  process.exit(1)
}

mkdirSync(pkgDir, { recursive: true })
cpSync(builtBinary, join(pkgDir, 'sia-storage.node'))
writeFileSync(
  join(pkgDir, 'package.json'),
  JSON.stringify(
    { name: pkgName, version, main: 'sia-storage.node' },
    null,
    2,
  ),
)

console.log(`Installed ${pkgName} with binary from ${builtBinary}`)
