import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetDir = resolve(__dirname, '../rust/sia-sdk-rs')

if (existsSync(targetDir)) {
  console.log('rust/sia-sdk-rs already exists, skipping clone.')
  process.exit(0)
}

const repo = 'https://github.com/alexfreska/sia-sdk-rs.git'
const branch = 'alex/wasm-experimental'

console.log(`Cloning ${repo} (branch: ${branch})...`)

try {
  execSync(
    `git clone --branch ${branch} --single-branch --depth 1 ${repo} ${targetDir}`,
    { stdio: 'inherit' },
  )
  console.log('Rust SDK source cloned successfully.')
} catch {
  console.warn(
    '\nWarning: Failed to clone Rust SDK source. The Rust source is needed to build the WASM module (see README for build instructions).\n',
  )
}
