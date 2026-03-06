import { execSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(__dirname, '..')
const sdkDir = resolve(projectDir, 'rust/sia-sdk-rs')
const wasmOut = resolve(projectDir, 'wasm')

const force = process.argv.includes('--force')

if (
  !force &&
  existsSync(resolve(wasmOut, 'sia.js')) &&
  existsSync(resolve(wasmOut, 'sia_bg.wasm'))
) {
  console.log(
    'WASM artifacts already exist, skipping build. Use --force to rebuild.',
  )
  process.exit(0)
}

if (!existsSync(sdkDir)) {
  console.error(
    `Error: Rust SDK not found at ${sdkDir}. Run 'bun install' first.`,
  )
  process.exit(1)
}

try {
  execSync('wasm-pack --version', { stdio: 'ignore' })
} catch {
  console.log('Installing wasm-pack...')
  execSync('cargo install wasm-pack', { stdio: 'inherit' })
}

console.log('Building WASM...')
execSync('wasm-pack build indexd_wasm --target web --out-dir pkg', {
  cwd: sdkDir,
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '--cfg=web_sys_unstable_apis' },
})

console.log('Copying artifacts...')
copyFileSync(
  resolve(sdkDir, 'indexd_wasm/pkg/indexd_wasm_bg.wasm'),
  resolve(wasmOut, 'sia_bg.wasm'),
)
copyFileSync(
  resolve(sdkDir, 'indexd_wasm/pkg/indexd_wasm.js'),
  resolve(wasmOut, 'sia.js'),
)
copyFileSync(
  resolve(sdkDir, 'indexd_wasm/pkg/indexd_wasm.d.ts'),
  resolve(wasmOut, 'sia.d.ts'),
)
copyFileSync(
  resolve(sdkDir, 'indexd_wasm/pkg/indexd_wasm_bg.wasm.d.ts'),
  resolve(wasmOut, 'sia_bg.wasm.d.ts'),
)

console.log('WASM build complete. Run `bun run scripts/patch-wasm-glue.ts` to finalize.')
