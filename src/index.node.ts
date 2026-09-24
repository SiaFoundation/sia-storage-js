export * from './node/napi'
export type * from './node/napi'

/** Node's traffic never goes through iCloud Private Relay, which is Safari's. */
export async function detectPrivateRelay(): Promise<boolean> {
  return false
}

// openStreams hands a browser page URLs that a service worker serves. Node
// streams objects with sdk.download() directly, so these only let code shared
// with the browser import them, and server rendering call them, without
// crashing.
export async function enableStreaming(): Promise<boolean> {
  return false
}

export function openStreams() {
  const unavailable = () =>
    Promise.reject(
      new Error('openStreams is for browser pages. In Node, use sdk.download().'),
    )
  return { url: unavailable, download: unavailable, close() {} }
}
