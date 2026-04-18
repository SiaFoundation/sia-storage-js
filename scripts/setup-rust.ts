import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetDir = resolve(__dirname, '../rust/sia-sdk-rs')

// Clone the upstream Rust SDK. This repo is a build pipeline —
// triggering a release intentionally picks up the latest HEAD so new
// upstream changes flow through without a SHA bump here.
//
// Temporarily pinned to alex/napi-typedef until that branch (which
// enables napi-derive's type-def feature so our build can emit a clean
// .d.ts) merges to master. Switch back to "master" once it lands.
export const SIA_SDK_RS_REPO = 'https://github.com/SiaFoundation/sia-sdk-rs.git'
export const SIA_SDK_RS_BRANCH = 'alex/napi-typedef'

if (existsSync(targetDir)) {
  console.log('rust/sia-sdk-rs already exists, skipping clone.')
  process.exit(0)
}

console.log(`Cloning ${SIA_SDK_RS_REPO} (branch: ${SIA_SDK_RS_BRANCH})...`)

try {
  execSync(
    `git clone --branch ${SIA_SDK_RS_BRANCH} --single-branch --depth 1 ${SIA_SDK_RS_REPO} ${targetDir}`,
    { stdio: 'inherit' },
  )
  console.log('Rust SDK source cloned successfully.')
} catch {
  console.warn(
    '\nWarning: Failed to clone Rust SDK source. Needed to build NAPI and WASM bindings.\n',
  )
}
