// File bytes come from whoever owns the share, so the browser must never cache
// them or run them as this origin's content.
const PROTECTIVE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Referrer-Policy': 'no-referrer',
}

export type ByteRange = {
  status: 200 | 206 | 416
  offset: number
  length: number
}

export function parseRange(range: string | null, size: number): ByteRange {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError('Invalid file size')
  }
  if (range === null) return { status: 200, offset: 0, length: size }

  const invalid: ByteRange = { status: 416, offset: 0, length: 0 }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) return invalid
  // Both groups always participate in a match, possibly as empty strings.
  const start = match[1]!
  const end = match[2]!

  // Range numerals are not limited to JS's safe integers. Compare before converting.
  const total = BigInt(size)
  let first: bigint
  let last: bigint
  if (!start) {
    const suffix = BigInt(end)
    if (suffix === 0n) return invalid
    first = suffix >= total ? 0n : total - suffix
    last = total - 1n
  } else {
    first = BigInt(start)
    last = end ? BigInt(end) : total - 1n
    if (first >= total || last < first) return invalid
    if (last >= total) last = total - 1n
  }
  return {
    status: 206,
    offset: Number(first),
    length: Number(last - first + 1n),
  }
}

export function contentDisposition(name: string, download: boolean) {
  // TextEncoder replaces lone surrogates without requiring toWellFormed(),
  // which older browsers with module service workers do not implement.
  const wellFormed = new TextDecoder().decode(new TextEncoder().encode(name))
  const filename =
    wellFormed
      // Filenames must not contain header controls or path separators.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
      .trim() || 'download'
  const fallback = filename.replace(/[^\u0020-\u007e]|[";]/g, '_')
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function responseHeaders(
  metadata: { name: string; mime: string; size: number },
  range: ByteRange,
  download: boolean,
) {
  // Only use a media type, never arbitrary header syntax from shared metadata.
  const mime = (metadata.mime.split(';', 1)[0] ?? '').trim()
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Length': String(range.length),
    'Content-Type': /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mime)
      ? mime
      : 'application/octet-stream',
    'Content-Disposition': contentDisposition(metadata.name, download),
    ...PROTECTIVE_HEADERS,
  })
  if (range.status === 206) {
    headers.set(
      'Content-Range',
      `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`,
    )
  } else if (range.status === 416) {
    headers.set('Content-Range', `bytes */${metadata.size}`)
  }
  return headers
}

export function errorResponse(status: number) {
  const headers = new Headers(PROTECTIVE_HEADERS)
  if (status === 405) headers.set('Allow', 'GET, HEAD')
  return new Response(null, { status, headers })
}
