// Compile-time checks, run by `bun run typecheck`: openStreams takes the
// credentials for the kind of SDK it is given, and rejects the other kind's.
import type { AppMetadata, Sdk, SharedSdk } from '../../wasm/sia_storage_wasm.js'
import { openStreams } from '..'

declare const shared: SharedSdk
declare const app: Sdk
declare const appMeta: AppMetadata
const indexerUrl = 'https://sia.storage'

export function checks() {
  openStreams(shared, { indexerUrl, seed: 'seed' })
  openStreams(app, { indexerUrl, appMeta })

  // @ts-expect-error an Sdk takes appMeta, not a seed
  openStreams(app, { indexerUrl, seed: 'seed' })
  // @ts-expect-error a SharedSdk takes a seed, not appMeta
  openStreams(shared, { indexerUrl, appMeta })
  // @ts-expect-error credentials are required
  openStreams(shared)
}
