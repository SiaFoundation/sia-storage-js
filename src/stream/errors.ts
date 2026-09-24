/** Only sanitized strings cross the diagnostic boundary, never raw SDK objects. */
export function streamErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown streaming failure'
  return message
    .replace(/\b(?:https?|wss?|sia):\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/(?:bearer\s+)[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(
      /((?:seed|share|token|key|authorization)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[redacted]',
    )
    .replace(/[a-f0-9]{64,}/gi, '[redacted]')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 1000)
}

export function reportStreamError(
  error: unknown,
  name: string,
  range: { offset: number; length: number } | undefined,
) {
  const message = streamErrorMessage(error)
  // One string rather than an object, so it reads the same in every console.
  const bytes = range
    ? ` bytes ${range.offset}-${range.offset + range.length - 1}`
    : ''
  console.error(`[Sia stream] ${streamErrorMessage(name)}${bytes}: ${message}`)
  return message
}
