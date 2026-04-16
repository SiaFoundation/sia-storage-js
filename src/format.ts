/** Decode a UTF-8 metadata byte array into a JSON object. Returns `{}` on failure. */
export function decodeMetadata(
  metadataBytes: Uint8Array,
): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(metadataBytes))
  } catch {
    return {}
  }
}
