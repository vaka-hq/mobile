/** Binary helpers for the media parsers; everything in these formats is big-endian. */

export function uint16(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

export function uint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0))
  )
}

/** 64-bit values as doubles; media offsets and 100ns timestamps stay far below 2^53. */
export function uint64(bytes: Uint8Array, offset: number) {
  return uint32(bytes, offset) * 0x100000000 + uint32(bytes, offset + 4)
}

/** ID3v2 sizes store seven bits per byte so they never contain a false frame sync. */
export function syncsafe(bytes: Uint8Array, offset: number) {
  return (
    (((bytes[offset] ?? 0) & 0x7f) << 21) |
    (((bytes[offset + 1] ?? 0) & 0x7f) << 14) |
    (((bytes[offset + 2] ?? 0) & 0x7f) << 7) |
    ((bytes[offset + 3] ?? 0) & 0x7f)
  )
}

export function ascii(bytes: Uint8Array, offset: number, length: number) {
  let text = ''

  for (let index = offset; index < offset + length && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0)
  }

  return text
}

export function latin1(bytes: Uint8Array) {
  return ascii(bytes, 0, bytes.length)
}

export function utf8(bytes: Uint8Array) {
  let text = ''
  let index = 0

  while (index < bytes.length) {
    const first = bytes[index] ?? 0
    let codePoint = 0xfffd
    let length = 1

    if (first < 0x80) {
      codePoint = first
    } else if (first >= 0xc0 && first < 0xe0) {
      codePoint = ((first & 0x1f) << 6) | ((bytes[index + 1] ?? 0) & 0x3f)
      length = 2
    } else if (first >= 0xe0 && first < 0xf0) {
      codePoint =
        ((first & 0x0f) << 12) |
        (((bytes[index + 1] ?? 0) & 0x3f) << 6) |
        ((bytes[index + 2] ?? 0) & 0x3f)
      length = 3
    } else if (first >= 0xf0 && first < 0xf8) {
      codePoint =
        ((first & 0x07) << 18) |
        (((bytes[index + 1] ?? 0) & 0x3f) << 12) |
        (((bytes[index + 2] ?? 0) & 0x3f) << 6) |
        ((bytes[index + 3] ?? 0) & 0x3f)
      length = 4
    }

    text += String.fromCodePoint(codePoint)
    index += length
  }

  return text
}

/** UTF-16 honouring a byte-order mark, otherwise in the given default order. */
export function utf16(bytes: Uint8Array, bigEndian = true) {
  let start = 0
  let big = bigEndian

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    start = 2
    big = true
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    start = 2
    big = false
  }

  const units: number[] = []

  for (let index = start; index + 1 < bytes.length; index += 2) {
    const high = bytes[index] ?? 0
    const low = bytes[index + 1] ?? 0

    units.push(big ? (high << 8) | low : (low << 8) | high)
  }

  return String.fromCharCode(...units)
}

/** Trailing NULs and whitespace that tag writers pad strings with. */
export function trimText(value: string) {
  return value.replaceAll('\u0000', '').trim()
}
