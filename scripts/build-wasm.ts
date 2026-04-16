import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(__dirname, '..')
const sdkDir = resolve(projectDir, 'rust/sia-sdk-rs')
const wasmCrateDir = resolve(sdkDir, 'sia_storage_wasm')
const pkgOutDir = resolve(wasmCrateDir, 'pkg')
const wasmOut = resolve(projectDir, 'wasm')

const force = process.argv.includes('--force')

if (
  !force &&
  existsSync(resolve(wasmOut, 'sia_storage_wasm.js')) &&
  existsSync(resolve(wasmOut, 'sia_storage_wasm_bg.wasm'))
) {
  console.log(
    'WASM artifacts already exist, skipping build. Use --force to rebuild.',
  )
  process.exit(0)
}

if (!existsSync(wasmCrateDir)) {
  console.error(
    `Error: sia_storage_wasm crate not found at ${wasmCrateDir}. Run 'bun run setup' first.`,
  )
  process.exit(1)
}

try {
  execSync('wasm-pack --version', { stdio: 'ignore' })
} catch {
  console.log('Installing wasm-pack...')
  execSync('cargo install wasm-pack', { stdio: 'inherit' })
}

// Align the wasm-bindgen CLI version with the version pinned in Cargo.lock.
// A mismatch between the CLI (which emits the JS glue) and the crate
// (compiled into the binary) causes subtle closure-lifecycle bugs at runtime.
const cargoLock = readFileSync(resolve(sdkDir, 'Cargo.lock'), 'utf-8')
const wbMatch = cargoLock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)
if (!wbMatch) {
  console.error('Could not find wasm-bindgen version in Cargo.lock')
  process.exit(1)
}
const wbVersion = wbMatch[1]

let cliVersion = ''
try {
  cliVersion = execSync('wasm-bindgen --version', { encoding: 'utf-8' })
    .trim()
    .replace('wasm-bindgen ', '')
} catch {}

if (cliVersion !== wbVersion) {
  console.log(
    `Installing wasm-bindgen-cli@${wbVersion} (was: ${cliVersion || 'not installed'})`,
  )
  execSync(`cargo install wasm-bindgen-cli --version ${wbVersion}`, {
    stdio: 'inherit',
  })
}

console.log('Building WASM (sia_storage_wasm)...')
execSync('wasm-pack build --target web --release --out-dir pkg', {
  cwd: wasmCrateDir,
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '--cfg=web_sys_unstable_apis' },
})

console.log('Copying artifacts into wasm/...')
for (const name of [
  'sia_storage_wasm.js',
  'sia_storage_wasm_bg.wasm',
  'sia_storage_wasm.d.ts',
  'sia_storage_wasm_bg.wasm.d.ts',
]) {
  const src = resolve(pkgOutDir, name)
  if (!existsSync(src)) {
    console.error(`Expected wasm-pack output ${src} not found`)
    process.exit(1)
  }
  copyFileSync(src, resolve(wasmOut, name))
}

console.log('WASM build complete.')
