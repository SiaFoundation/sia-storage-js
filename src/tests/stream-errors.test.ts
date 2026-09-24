import { expect, test } from 'bun:test'

import { streamErrorMessage } from '../stream/errors'

test('stream diagnostics preserve useful causes but redact credentials and URLs', () => {
  const seed = 'ab'.repeat(32)
  const message = streamErrorMessage(
    new Error(
      `Host unavailable https://user:password@host.test/path#share=${seed} seed=${seed} Bearer secret-token`,
    ),
  )
  expect(message).toContain('Host unavailable')
  expect(message).not.toContain(seed)
  expect(message).not.toContain('password')
  expect(message).not.toContain('secret-token')
  expect(message).not.toContain('host.test')
})

test('unknown objects become a placeholder and long messages are cut to 1000 characters', () => {
  expect(streamErrorMessage({ seed: 'private' })).toBe(
    'Unknown streaming failure',
  )
  expect(streamErrorMessage('x'.repeat(2000))).toHaveLength(1000)
})
