import { AppKey, Builder, type SDK } from './init'
import { toHex } from '../hex'

export class SiaClient {
  readonly sdk: SDK
  readonly indexerUrl: string
  /** @internal used by upload/download workers */
  readonly keyHex: string

  constructor(sdk: SDK, indexerUrl: string) {
    this.sdk = sdk
    this.indexerUrl = indexerUrl
    this.keyHex = toHex(sdk.appKey().export())
  }
}

export async function connect(
  indexerUrl: string,
  appKey: AppKey,
): Promise<SiaClient | null> {
  const builder = new Builder(indexerUrl)
  const sdk = await builder.connected(appKey)
  if (!sdk) return null
  return new SiaClient(sdk, indexerUrl)
}
