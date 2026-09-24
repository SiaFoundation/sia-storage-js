/**
 * Whether the visitor is on iCloud Private Relay, which the SDK does not work
 * through. Show them a way to turn it off in iCloud settings.
 *
 * Asks check-relay.sia.storage, a Sia Foundation service that compares the
 * caller's address with Apple's published list of Private Relay addresses.
 * Only Safari's traffic goes through Private Relay, so other browsers resolve
 * false without a request. The answer is kept for the page's lifetime, and a
 * failure to get one resolves false.
 */
const RELAY_CHECK_URL = 'https://check-relay.sia.storage'
const TIMEOUT = 5000

let answer: Promise<boolean> | undefined

export function detectPrivateRelay(): Promise<boolean> {
  answer ??=
    typeof navigator === 'undefined'
      ? Promise.resolve(false)
      : checkPrivateRelay(navigator.userAgent, fetch)
  return answer
}

/** `detectPrivateRelay` without the caching, for tests. */
export async function checkPrivateRelay(
  userAgent: string,
  request: typeof fetch,
): Promise<boolean> {
  const safari =
    /Version\/\S+.*Safari\//.test(userAgent) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|OPiOS|Ddg\/|Android/.test(userAgent)
  if (!safari) return false
  try {
    const response = await request(RELAY_CHECK_URL, {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const body = (await response.json()) as { relay?: unknown }
    return body.relay === true
  } catch {
    return false
  }
}
