#!/usr/bin/env bun
// Generate dist/index.node.d.ts to avoid tsup's $1 name-collision suffixes.
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

// Patch unresolved LogFn alias until napi-rs supports ts_args_type for it.
content = content.replace(
  /callback: LogFn,/,
  'callback: (message: string) => void,',
)

content += `
export declare function initSia(): Promise<void>
export declare function detectPrivateRelay(): Promise<boolean>
/** Always false. Service worker streaming is for browser pages. */
export declare function enableStreaming(options?: { workerUrl?: string; scope?: string; type?: 'classic' | 'module' }): Promise<boolean>
/** For browser pages. In Node, \`url\` and \`download\` reject, and \`sdk.download()\` streams objects directly. */
export declare function openStreams(sdk: object, credentials: { indexerUrl: string; appMeta: AppMetadata } | { indexerUrl: string; seed: string }): {
  url(object: PinnedObject, options: { name: string; type?: string }): Promise<never>
  download(object: PinnedObject, options: { name: string; type?: string }): Promise<never>
  close(): void
}
`

writeFileSync(OUT, content)
console.log(`✓ ${OUT}`)
