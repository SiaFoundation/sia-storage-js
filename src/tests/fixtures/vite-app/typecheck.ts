// Type-resolution probe for the "browser" condition: under bundler-mode TS the
// package's WASM .d.ts must resolve. PackedUpload.length()/remaining() return
// `number` in the WASM build and `bigint` in the NAPI build, so the numeric
// arithmetic below only typechecks against the WASM types.

import type { PackedUpload } from '@siafoundation/sia-storage'

declare const u: PackedUpload

const total: number = u.length() + u.remaining() + 1
void total
