import { describe, expect, test } from 'bun:test'
import { decodeMetadata } from '../format'

describe('decodeMetadata', () => {
  test('decodes valid JSON', () => {
    const data = new TextEncoder().encode('{"name":"test.txt","size":100}')
    expect(decodeMetadata(data)).toEqual({ name: 'test.txt', size: 100 })
  })

  test('returns empty object for invalid JSON', () => {
    const data = new TextEncoder().encode('not json')
    expect(decodeMetadata(data)).toEqual({})
  })

  test('returns empty object for empty input', () => {
    expect(decodeMetadata(new Uint8Array([]))).toEqual({})
  })
})
