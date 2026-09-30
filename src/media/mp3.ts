import { ascii, latin1, syncsafe, trimText, uint32, utf16, utf8 } from './bytes'
import type { MediaChapter, MediaInfo } from './media-info'
import type { ByteSource } from './source'

/** Tags with large embedded artwork are still read, but a pathological tag is not. */
const maxTagSize = 4 * 1024 * 1024

/** ID3v2 text: an encoding byte, then ISO-8859-1, UTF-16 with BOM, UTF-16BE or UTF-8. */
export function id3Text(bytes: Uint8Array) {
  const body = bytes.subarray(1)

  switch (bytes[0]) {
    case 1:
      return trimText(utf16(body, false))
    case 2:
      return trimText(utf16(body, true))
    case 3:
      return trimText(utf8(body))
    default:
      return trimText(latin1(body))
  }
}

type Frame = {
  id: string
  body: Uint8Array
}

function frames(bytes: Uint8Array, start: number, end: number, version: number) {
  const found: Frame[] = []
  let offset = start

  while (offset + 10 <= end) {
    const id = ascii(bytes, offset, 4)

    if (!/^[A-Z0-9]{4}$/u.test(id)) {
      break
    }

    const size = version === 4 ? syncsafe(bytes, offset + 4) : uint32(bytes, offset + 4)

    if (size <= 0 || offset + 10 + size > end) {
      break
    }

    found.push({ id, body: bytes.subarray(offset + 10, offset + 10 + size) })
    offset += 10 + size
  }

  return found
}

/** `CHAP` frames: an element ID, millisecond start/end, byte offsets, then sub-frames (TIT2). */
function chapterFrame(frame: Frame, version: number): (MediaChapter & { id: string }) | null {
  const terminator = frame.body.indexOf(0)

  if (terminator < 0 || terminator + 17 > frame.body.length) {
    return null
  }

  const id = latin1(frame.body.subarray(0, terminator))
  const start = uint32(frame.body, terminator + 1) / 1000

  const title = frames(frame.body, terminator + 17, frame.body.length, version).find(
    (subframe) => subframe.id === 'TIT2',
  )

  return { id, start, title: title ? id3Text(title.body) : '' }
}

export type Id3Tag = {
  size: number
  chapters: MediaChapter[]
  lengthSeconds: number | null
}

export function parseId3(bytes: Uint8Array): Id3Tag | null {
  if (ascii(bytes, 0, 3) !== 'ID3') {
    return null
  }

  const version = bytes[3] ?? 0
  const flags = bytes[5] ?? 0
  const size = 10 + syncsafe(bytes, 6) + (flags & 0x10 ? 10 : 0)

  if (version < 3 || version > 4) {
    return { size, chapters: [], lengthSeconds: null }
  }

  let start = 10

  if (flags & 0x40) {
    start += version === 4 ? syncsafe(bytes, 10) : uint32(bytes, 10) + 4
  }

  const chapters: MediaChapter[] = []
  let lengthSeconds: number | null = null

  for (const frame of frames(bytes, start, Math.min(bytes.length, size), version)) {
    if (frame.id === 'CHAP') {
      const chapter = chapterFrame(frame, version)

      if (chapter) {
        chapters.push({ title: chapter.title, start: chapter.start })
      }
    } else if (frame.id === 'TLEN') {
      const milliseconds = Number(id3Text(frame.body))

      lengthSeconds = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : null
    }
  }

  return { size, chapters: chapters.sort((left, right) => left.start - right.start), lengthSeconds }
}

const bitrates = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}

const sampleRates = {
  mpeg1: [44100, 48000, 32000],
  mpeg2: [22050, 24000, 16000],
  mpeg25: [11025, 12000, 8000],
}

/**
 * Duration from the first MPEG Layer III frame: exact from a Xing/Info or VBRI frame count,
 * otherwise estimated from the constant bitrate.
 */
export function mp3Duration(frame: Uint8Array, audioBytes: number | null) {
  let sync = -1

  for (let offset = 0; offset + 4 <= frame.length; offset += 1) {
    if (frame[offset] === 0xff && ((frame[offset + 1] ?? 0) & 0xe0) === 0xe0) {
      sync = offset
      break
    }
  }

  if (sync < 0) {
    return null
  }

  const header = uint32(frame, sync)
  const versionBits = (header >>> 19) & 0x3
  const layerBits = (header >>> 17) & 0x3
  const bitrateIndex = (header >>> 12) & 0xf
  const rateIndex = (header >>> 10) & 0x3
  const mono = ((header >>> 6) & 0x3) === 3

  if (
    versionBits === 1 ||
    layerBits !== 1 ||
    rateIndex === 3 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15
  ) {
    return null
  }

  const mpeg1 = versionBits === 3

  const sampleRate =
    (mpeg1 ? sampleRates.mpeg1 : versionBits === 2 ? sampleRates.mpeg2 : sampleRates.mpeg25)[
      rateIndex
    ] ?? 0

  const bitrate = (mpeg1 ? bitrates.mpeg1 : bitrates.mpeg2)[bitrateIndex] ?? 0
  const samplesPerFrame = mpeg1 ? 1152 : 576
  const sideInfo = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17
  const xing = sync + 4 + sideInfo
  const xingTag = ascii(frame, xing, 4)

  if ((xingTag === 'Xing' || xingTag === 'Info') && uint32(frame, xing + 4) & 0x1) {
    return (uint32(frame, xing + 8) * samplesPerFrame) / sampleRate
  }

  if (ascii(frame, sync + 36, 4) === 'VBRI') {
    return (uint32(frame, sync + 36 + 14) * samplesPerFrame) / sampleRate
  }

  return bitrate > 0 && audioBytes !== null ? (audioBytes * 8) / (bitrate * 1000) : null
}

export async function readMp3(source: ByteSource): Promise<MediaInfo> {
  const size = await source.size()
  const head = await source.read(0, 10)
  let tagSize = 0
  let chapters: MediaChapter[] = []
  let length: number | null = null

  if (ascii(head, 0, 3) === 'ID3') {
    tagSize = 10 + syncsafe(head, 6) + ((head[5] ?? 0) & 0x10 ? 10 : 0)

    const tag = parseId3(await source.read(0, Math.min(tagSize, maxTagSize)))

    chapters = tag?.chapters ?? []
    length = tag?.lengthSeconds ?? null
  }

  const frame = await source.read(tagSize, 4096)
  const duration = mp3Duration(frame, size === null ? null : size - tagSize) ?? length

  return { duration, chapters }
}
