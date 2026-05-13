// Type-resolution probe for the "bun" condition: under bundler-mode TS the
// package's NAPI .d.ts must resolve. PackedUpload.length()/remaining() return
// `bigint` in the NAPI build and `number` in the WASM build, so the bigint
// arithmetic below only typechecks against the NAPI types.

import type { PackedUpload } from '@siafoundation/sia-storage'

declare const u: PackedUpload

const total: bigint = u.length() + u.remaining() + 1n
void total
