/** Hardcover shows keys as `Bearer …`; accept them pasted with or without that prefix. */
export function normalizeApiKey(value: string) {
  return value
    .trim()
    .replace(/^bearer\s+/iu, '')
    .trim()
}
