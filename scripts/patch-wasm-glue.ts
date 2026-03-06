import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wasmDir = resolve(__dirname, '../wasm')

const siaJs = resolve(wasmDir, 'sia.js')

let content = readFileSync(siaJs, 'utf-8')

// 1. Patch the bare `env` import to a relative import
content = content.replace(
  /import \* as (\w+) from 'env';/,
  "import * as $1 from './wasm-env.js';",
)

// 2. Replace internal references to indexd_wasm_bg.wasm with sia_bg.wasm
content = content.replace(/indexd_wasm_bg\.wasm/g, 'sia_bg.wasm')

writeFileSync(siaJs, content)

console.log('Patched wasm/sia.js:')
console.log('  - env import → ./wasm-env.js')
console.log('  - indexd_wasm_bg.wasm → sia_bg.wasm')
