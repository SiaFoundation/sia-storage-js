import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetDir = resolve(__dirname, '../rust/sia-sdk-rs')

// Pinned to a specific commit on SiaFoundation/sia-sdk-rs master.
// Bump this when upstream changes need to flow through.
export const SIA_SDK_RS_REPO = 'https://github.com/SiaFoundation/sia-sdk-rs.git'
export const SIA_SDK_RS_SHA = 'dc39feb8822a8aadc9d0fb97651f9904db018a93'

if (existsSync(targetDir)) {
  console.log('rust/sia-sdk-rs already exists, skipping clone.')
  process.exit(0)
}

console.log(`Cloning ${SIA_SDK_RS_REPO} @ ${SIA_SDK_RS_SHA}...`)

try {
  execSync(`git clone ${SIA_SDK_RS_REPO} ${targetDir}`, { stdio: 'inherit' })
  execSync(`git checkout ${SIA_SDK_RS_SHA}`, {
    cwd: targetDir,
    stdio: 'inherit',
  })
  console.log('Rust SDK source cloned successfully.')
} catch {
  console.warn(
    '\nWarning: Failed to clone Rust SDK source. The Rust source is needed to build the NAPI and WASM bindings (see README for build instructions).\n',
  )
}
