import { describe, expect, test } from 'bun:test'
import { fromHex, toHex } from '../hex'

describe('toHex', () => {
  test('converts empty array', () => {
    expect(toHex(new Uint8Array([]))).toBe('')
  })

  test('converts single byte', () => {
    expect(toHex(new Uint8Array([0]))).toBe('00')
    expect(toHex(new Uint8Array([255]))).toBe('ff')
    expect(toHex(new Uint8Array([16]))).toBe('10')
  })

  test('converts multiple bytes', () => {
    expect(toHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef')
  })

  test('pads single-digit hex values', () => {
    expect(toHex(new Uint8Array([1, 2, 3]))).toBe('010203')
  })
})

describe('fromHex', () => {
  test('converts empty string', () => {
    expect(fromHex('')).toEqual(new Uint8Array([]))
  })

  test('converts hex string to bytes', () => {
    expect(fromHex('deadbeef')).toEqual(
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    )
  })

  test('handles uppercase', () => {
    expect(fromHex('DEADBEEF')).toEqual(
      new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    )
  })

  test('roundtrips with toHex', () => {
    const original = new Uint8Array([0, 127, 255, 1, 128])
    expect(fromHex(toHex(original))).toEqual(original)
  })
})
