import { describe, expect, mock, test } from 'bun:test'

import { checkPrivateRelay } from '../relay'

const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'
const FIREFOX_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15'
const DUCKDUCKGO_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Ddg/18.0 Safari/604.1'

const answering = (body: unknown) =>
  mock(async () => Response.json(body)) as unknown as typeof fetch

describe('private relay detection', () => {
  test.each([SAFARI_MAC, SAFARI_IPHONE])(
    'Safari asks the relay check and trusts its answer: %s',
    async (agent) => {
      const request = answering({ relay: true })
      expect(await checkPrivateRelay(agent, request)).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(await checkPrivateRelay(agent, answering({ relay: false }))).toBe(false)
    },
  )

  test.each([CHROME_MAC, CHROME_IPHONE, FIREFOX_IPHONE, DUCKDUCKGO_IPHONE])(
    'other browsers are never on relay and never ask: %s',
    async (agent) => {
      const request = answering({ relay: true })
      expect(await checkPrivateRelay(agent, request)).toBe(false)
      expect(request).not.toHaveBeenCalled()
    },
  )

  test('a failed or malformed answer means not on relay', async () => {
    const failing = mock(async () => {
      throw new TypeError('Load failed')
    }) as unknown as typeof fetch
    expect(await checkPrivateRelay(SAFARI_MAC, failing)).toBe(false)
    expect(await checkPrivateRelay(SAFARI_MAC, answering({ relay: 'yes' }))).toBe(false)
    expect(await checkPrivateRelay(SAFARI_MAC, answering(null))).toBe(false)
  })
})
