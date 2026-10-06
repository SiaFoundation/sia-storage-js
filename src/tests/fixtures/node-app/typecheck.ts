// Type-resolution probe for the "node" condition: under bundler-mode TS the
// package's NAPI .d.ts must resolve. PackedUpload.length()/remaining() return
// `bigint` in the NAPI build and `number` in the WASM build, so the bigint
// arithmetic below only typechecks against the NAPI types.

import type { PackedUpload } from '@siafoundation/sia-storage'

declare const u: PackedUpload

const total: bigint = u.length() + u.remaining() + 1n
void total

// The Node typings declare the browser's streaming types by hand. Code shared
// with the browser has to typecheck against them, so they must keep up.
import type { FileEvents, StreamStatus } from '@siafoundation/sia-storage'

const idle: StreamStatus = 'idle'
const events: FileEvents = { onStatus: (status) => void (status === idle) }
void events
