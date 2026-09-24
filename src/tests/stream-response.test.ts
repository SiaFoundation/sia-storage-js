import { describe, expect, test } from 'bun:test'

import {
  contentDisposition,
  parseRange,
  responseHeaders,
} from '../stream/response'

describe('stream byte ranges', () => {
  test('full and empty files without a range', () => {
    expect(parseRange(null, 100)).toEqual({
      status: 200,
      offset: 0,
      length: 100,
    })
    expect(parseRange(null, 0)).toEqual({ status: 200, offset: 0, length: 0 })
  })

  test.each([
    ['bytes=0-0', 0, 1],
    ['bytes=20-39', 20, 20],
    ['bytes=20-', 20, 80],
    ['bytes=-20', 80, 20],
    ['bytes=-100', 0, 100],
    ['bytes=-101', 0, 100],
    ['bytes=90-999', 90, 10],
    ['bytes=0-999999999999999999999999999', 0, 100],
    ['bytes=-999999999999999999999999999', 0, 100],
    [' bytes=001-002 ', 1, 2],
    ['BYTES=99-', 99, 1],
  ])('%s is served as a 206', (value, offset, length) => {
    expect(parseRange(value, 100)).toEqual({ status: 206, offset, length })
  })

  test.each([
    '',
    'bytes=',
    'bytes=-',
    'bytes=-0',
    'bytes=100-',
    'bytes=100-101',
    'bytes=30-20',
    'bytes=999999999999999999999999999-',
    'bytes=0-1,5-6',
    'bytes=0-1,',
    'bytes=1.5-2',
    'bytes=+1-2',
    'bytes=0 - 1',
    'bytes=--1',
    'items=0-1',
  ])('rejects invalid or unsatisfiable range %s', (value) => {
    expect(parseRange(value, 100)).toEqual({
      status: 416,
      offset: 0,
      length: 0,
    })
  })

  test.each(['bytes=0-', 'bytes=0-0', 'bytes=-1'])(
    'no range is satisfiable for an empty file: %s',
    (value) => {
      expect(parseRange(value, 0).status).toBe(416)
    },
  )

  test('supports safe-integer file sizes without rounding range endpoints', () => {
    expect(
      parseRange(
        'bytes=9007199254740990-9007199254740999',
        Number.MAX_SAFE_INTEGER,
      ),
    ).toEqual({ status: 206, offset: 9007199254740990, length: 1 })
    for (const size of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      expect(() => parseRange(null, size)).toThrow(RangeError)
    }
  })
})

describe('stream response headers', () => {
  const metadata = { size: 100, mime: 'video/mp4', name: '動画.mp4' }

  test.each([
    [null, '100', null],
    ['bytes=20-39', '20', 'bytes 20-39/100'],
    ['bytes=-5', '5', 'bytes 95-99/100'],
    ['bytes=99-999', '1', 'bytes 99-99/100'],
    ['bytes=100-', '0', 'bytes */100'],
  ])('builds headers for %s', (value, length, contentRange) => {
    const headers = responseHeaders(metadata, parseRange(value, 100), false)
    expect(headers.get('Content-Length')).toBe(length)
    expect(headers.get('Content-Range')).toBe(contentRange)
    expect(headers.get('Accept-Ranges')).toBe('bytes')
    expect(headers.get('Content-Type')).toBe('video/mp4')
    expect(headers.get('Content-Disposition')).toStartWith('inline;')
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('Content-Security-Policy')).toBe(
      "sandbox; default-src 'none'",
    )
  })

  test('download uses attachment and a Unicode filename with an ASCII fallback', () => {
    expect(contentDisposition('動画.mp4', true)).toBe(
      'attachment; filename="__.mp4"; filename*=UTF-8\'\'%E5%8B%95%E7%94%BB.mp4',
    )
  })

  test('filenames cannot inject headers or quoted-string delimiters', () => {
    const disposition = contentDisposition('a"/\\;\r\né\'().html', false)
    expect(disposition).not.toMatch(/[\r\n]/)
    expect(disposition).toContain('filename="a_______\'().html"')
    expect(disposition).toContain('%22__%3B__%C3%A9%27%28%29.html')
    expect(() => contentDisposition('\ud800.txt', true)).not.toThrow()
    expect(contentDisposition('', false)).toContain('filename="download"')
  })

  test('untrusted MIME metadata cannot inject headers', () => {
    const headers = responseHeaders(
      { ...metadata, mime: 'text/html\r\nX-Unsafe: yes' },
      parseRange(null, 100),
      false,
    )
    expect(headers.get('Content-Type')).toBe('application/octet-stream')
    expect(headers.get('X-Unsafe')).toBeNull()
  })
})
