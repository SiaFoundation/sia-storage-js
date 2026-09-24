// The prebuilt worker, dist/sia-storage-sw.js. Its build inlines the
// WebAssembly, so a site serves this one file and nothing beside it.
import wasm from 'virtual:sia-storage-wasm'

import { installStreams, type StreamScope } from './stream-worker'

installStreams(self as unknown as StreamScope, { wasm })
