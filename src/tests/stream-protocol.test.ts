import { describe, expect, test } from 'bun:test'

import { isSourceReply } from '../stream/protocol'

const file = { type: 'source', session: 's', objectId: 'o', name: 'n', mime: 'm', size: 1 }
const shared = { kind: 'shared', indexerUrl: 'https://i', seed: 'ab' }
const appMeta = { appId: '0', name: 'a', description: 'd', serviceUrl: 'https://a' }
const app = { kind: 'app', indexerUrl: 'https://i', appKey: '07', appMeta }

describe('the worker checks the page reply', () => {
  test('a SharedSdk file with its seed passes', () => {
    expect(isSourceReply({ ...file, connection: shared })).toBe(true)
  })

  test('an app Sdk file with its key, metadata and sealed object passes', () => {
    expect(isSourceReply({ ...file, connection: app, sealed: {} })).toBe(true)
  })

  test.each([
    ['an app Sdk file without its sealed object', { ...file, connection: app }],
    ['an app Sdk file with a null sealed object', { ...file, connection: app, sealed: null }],
    ['app metadata missing a field', { ...file, connection: { ...app, appMeta: { appId: '0' } }, sealed: {} }],
    ['a shared connection without a seed', { ...file, connection: { kind: 'shared', indexerUrl: 'x' } }],
    ['an unknown connection kind', { ...file, connection: { kind: 'other', indexerUrl: 'x' } }],
    ['a negative size', { ...file, size: -1, connection: shared }],
    ['the page declining', { type: 'error' }],
  ])('%s is rejected', (_, reply) => {
    expect(isSourceReply(reply)).toBe(false)
  })
})
