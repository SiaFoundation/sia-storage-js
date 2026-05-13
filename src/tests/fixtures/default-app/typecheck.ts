// Type-resolution probe for the exports `default` fallback — matched when no
// other condition fits (Deno, edge runtimes, generic ESM tooling). The default
// block routes to the WASM .d.ts, so PackedUpload.length() returns `number`.
//
// Bundler mode without customConditions exhausts the listed conditions and
// falls through to `default`.

import type { PackedUpload } from '@siafoundation/sia-storage'

declare const u: PackedUpload

const total: number = u.length() + u.remaining() + 1
void total
