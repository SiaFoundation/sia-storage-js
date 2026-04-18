#!/usr/bin/env bun
// Emit dist/index.node.d.ts from the auto-generated NAPI types plus our
// wrapper declarations. Skipping tsup's d.ts bundle for the node entry
// avoids name-collision $1 suffixes in the published surface.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SRC = join(ROOT, 'src/node/napi.generated.d.ts')
const OUT = join(ROOT, 'dist/index.node.d.ts')

if (!existsSync(SRC)) {
  console.error(`Missing ${SRC} — run \`bun run setup-napi-test\` first.`)
  process.exit(1)
}

let content = readFileSync(SRC, 'utf-8')

// Patch LogFn (Rust internal type alias unresolved by napi-rs --dts) until
// upstream adds an explicit ts_args_type. See sia_storage_napi/src/logging.rs.
content = content.replace(
  /callback: LogFn,/,
  'callback: (message: string) => void,',
)

content += `
/** Initialize the SDK. Loads the native addon eagerly so missing-binary errors surface immediately. */
export declare function initSia(): Promise<void>

/** Reconnect a returning user with a stored AppKey. */
export declare function connect(indexerUrl: string, appMeta: AppMetadata, appKey: AppKey): Promise<Sdk | null>
`

writeFileSync(OUT, content)
console.log(`✓ ${OUT}`)
