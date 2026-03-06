#!/usr/bin/env bun
// Build the NAPI binary from rust/sia-sdk-rs/indexd_node and install it
// into node_modules so the node entry point can load it during tests.
// Prerequisites: Rust toolchain, `bun run setup` already run.
import { execSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')
const INDEXD_NODE_DIR = join(ROOT, 'rust', 'sia-sdk-rs', 'indexd_node')

const platform = process.platform
const arch = process.arch
let suffix = `${platform}-${arch}`
if (platform === 'linux') suffix = `${platform}-${arch}-gnu`
else if (platform === 'win32') suffix = `${platform}-${arch}-msvc`

const pkgName = `@siafoundation/sia-${suffix}`
const pkgDir = join(ROOT, 'node_modules', '@siafoundation', `sia-${suffix}`)
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version
const binaryName = `indexd_node.${platform}-${arch}.node`
const builtBinary = join(INDEXD_NODE_DIR, binaryName)

// Check if binary already exists in node_modules
if (existsSync(join(pkgDir, 'indexd_node.node'))) {
  console.log(`${pkgName} already installed, skipping build`)
  process.exit(0)
}

// Check if source exists
if (!existsSync(INDEXD_NODE_DIR)) {
  console.error(`indexd_node crate not found at ${INDEXD_NODE_DIR}`)
  console.error("Run 'bun run setup' first to clone sia-sdk-rs.")
  process.exit(1)
}

// Build if not already built
if (!existsSync(builtBinary)) {
  console.log(`Building NAPI binary in ${INDEXD_NODE_DIR}...`)
  execSync('bun x @napi-rs/cli build --release --platform', {
    cwd: INDEXD_NODE_DIR,
    stdio: 'inherit',
  })
}

if (!existsSync(builtBinary)) {
  console.error(`Build did not produce ${builtBinary}`)
  process.exit(1)
}

mkdirSync(pkgDir, { recursive: true })
cpSync(builtBinary, join(pkgDir, 'indexd_node.node'))
writeFileSync(
  join(pkgDir, 'package.json'),
  JSON.stringify(
    {
      name: pkgName,
      version,
      main: 'indexd_node.node',
    },
    null,
    2,
  ),
)

console.log(`Installed ${pkgName} with binary from ${builtBinary}`)
