import { afterEach, describe, expect, setSystemTime, test } from 'bun:test'

import { createLogRelay, type LogScope, redactLogLine } from '../stream/logs'
import { isSourceReply } from '../stream/protocol'

describe('worker log redaction', () => {
  test('host keys and host addresses stay, so a line still says which host failed', () => {
    const line = `[WT] dial of host ed25519:${'ab'.repeat(32)} failed: WebTransport ready: https://host.example:9984/sia/rhp/v4 closed`
    expect(redactLogLine(line)).toBe(line)
  })

  test('the signature on an indexer request and the key in a share URL are cut', () => {
    const signature = 'c2lnbmF0dXJl'.repeat(8)
    const key = 'a2V5'.repeat(11)
    const line = redactLogLine(
      `error sending request for url (https://indexer.test/shared/hosts?sv=1&sc=pub&ss=${signature}) ` +
        `sia://indexer.test/objects/abc/shared?ss=${signature}#encryption_key=${key}`,
    )
    expect(line).toBe(
      'error sending request for url (https://indexer.test/shared/hosts?[redacted]) ' +
        'sia://indexer.test/objects/abc/shared?[redacted]',
    )
  })

  test('parentheses in a URL do not end it before its query is cut', () => {
    expect(redactLogLine('url (https://indexer.test/tenant(v1)/hosts?ss=SECRET)')).toBe(
      'url (https://indexer.test/tenant(v1)/hosts?[redacted])',
    )
    expect(redactLogLine('https://indexer.test/hosts?filter=(active)&ss=SECRET next')).toBe(
      'https://indexer.test/hosts?[redacted] next',
    )
  })
})

/** A relay over a stand-in scope, whose pages record what they are sent. */
function relay() {
  const open = new Map<string, { id: string; postMessage(message: unknown): void }>()
  const received = new Map<string, unknown[]>()
  const levels: string[] = []
  const scope: LogScope = {
    clients: { get: async (id) => open.get(id) },
    addEventListener() {},
  }
  const logs = createLogRelay(scope, (level) => void levels.push(level))
  const page = (id: string) => {
    const client = {
      id,
      postMessage: (message: unknown) =>
        received.set(id, [...(received.get(id) ?? []), message]),
    }
    open.set(id, client)
    return client
  }
  return { logs, page, open, received, levels }
}

describe('the worker log relay', () => {
  // A relay with a subscribed page wraps console.error to catch panics.
  const consoleError = console.error
  afterEach(() => {
    console.error = consoleError
  })

  test('an error goes at once, to each page that asked, with the lines queued before it', () => {
    const { logs, page, received, levels } = relay()
    logs.subscribe(page('debug'), 'debug')
    logs.subscribe(page('error'), 'error')
    logs.subscribe(page('none'), undefined)
    logs.subscribe(page('bad'), 'verbose')
    logs.sdk('[TRACE] trace')
    logs.sdk('[DEBUG] debug')
    logs.sdk('[ERROR] error')
    expect(received.get('debug')).toEqual([
      {
        type: 'sia-log',
        lines: [
          { level: 'debug', message: 'debug' },
          { level: 'error', message: 'error' },
        ],
      },
    ])
    expect(received.get('error')).toEqual([
      { type: 'sia-log', lines: [{ level: 'error', message: 'error' }] },
    ])
    expect(received.has('none')).toBe(false)
    expect(received.has('bad')).toBe(false)
    expect(levels).toEqual(['debug'])
  })

  test('with no page asking, nothing is sent and the SDK level is never set', async () => {
    const { logs, page, received, levels } = relay()
    page('quiet')
    logs.sdk('[ERROR] error')
    await Bun.sleep(300)
    expect(received.size).toBe(0)
    expect(levels).toEqual([])
  })

  test('the SDK stops logging once the only page that asked has closed', async () => {
    const { logs, page, open, levels } = relay()
    logs.subscribe(page('a'), 'debug')
    open.delete('a')
    setSystemTime(new Date(Date.now() + 11_000))
    try {
      logs.sdk('[ERROR] error')
      await Bun.sleep(0)
    } finally {
      setSystemTime()
    }
    expect(levels).toEqual(['debug', 'off'])
  })

  test('the SDK level drops when the page that asked for more has closed', async () => {
    const { logs, page, open, levels } = relay()
    logs.subscribe(page('a'), 'trace')
    open.delete('a')
    logs.subscribe(page('b'), 'warn')
    await Bun.sleep(0)
    expect(levels).toEqual(['trace', 'warn'])
  })
})

describe('the source reply', () => {
  const reply = {
    type: 'source',
    session: 's',
    objectId: 'o',
    name: 'n',
    mime: 'm',
    size: 1,
    connection: { kind: 'shared', indexerUrl: 'https://i', seed: 'ab' },
  }

  // isSourceReply ignores fields it does not know, and is the same check a
  // worker from before logLevel runs, so such a worker still serves a page
  // that sends one.
  test('passes with a log level, an unknown level or a field the worker does not know', () => {
    expect(isSourceReply({ ...reply, logLevel: 'debug' })).toBe(true)
    expect(isSourceReply({ ...reply, logLevel: 'verbose' })).toBe(true)
    expect(isSourceReply({ ...reply, future: true })).toBe(true)
  })
})
