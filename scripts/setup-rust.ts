// Clone sia-sdk-rs into rust/sia-sdk-rs at the version listed in
// .sia-sdk-rs.json. Relies on the upstream invariant that napi and wasm
// release tags share a commit, so cloning at the napi tag puts both crates
// in the correct state (see .github/workflows/check-sdk-update.yml for the
// full assumption + failure mode).
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(__dirname, '..')
const targetDir = resolve(projectDir, 'rust/sia-sdk-rs')
const versionsPath = resolve(projectDir, '.sia-sdk-rs.json')

const REPO = 'https://github.com/SiaFoundation/sia-sdk-rs.git'

const versions = JSON.parse(readFileSync(versionsPath, 'utf-8')) as {
  napi: string
  wasm: string
}
const ref = versions.napi

if (existsSync(targetDir)) {
  console.log('rust/sia-sdk-rs already exists, skipping clone.')
  process.exit(0)
}

console.log(`Cloning ${REPO} at ${ref}...`)

try {
  execSync(
    `git clone --branch ${ref} --single-branch --depth 1 ${REPO} ${targetDir}`,
    { stdio: 'inherit' },
  )
  console.log('Rust SDK source cloned successfully.')
} catch {
  console.warn(
    '\nWarning: Failed to clone Rust SDK source. Needed to build NAPI and WASM bindings.\n',
  )
}
