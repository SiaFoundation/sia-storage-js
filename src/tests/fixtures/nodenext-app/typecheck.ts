// Type-resolution probe for "moduleResolution: nodenext" — the resolution
// mode used by libraries and Node 16+ apps with TS. nodenext does NOT honor
// customConditions; it walks the exports field with the "node" condition
// implicitly active, so the NAPI .d.ts must resolve.

import type { PackedUpload } from '@siafoundation/sia-storage'

declare const u: PackedUpload

const total: bigint = u.length() + u.remaining() + 1n
void total
