import { ascii, uint16, uint32, uint64, utf16, utf8, trimText } from './bytes'
import type { MediaChapter, MediaInfo } from './media-info'
import { type ByteSource, ReadBudgetExceededError } from './source'

type Box = {
  type: string
  /** Offset of the box header. */
  start: number
  /** Offset of the payload, after the (possibly 64-bit) header. */
  payload: number
  /** Offset just past the box. */
  end: number
}

type Track = {
  id: number
  handler: string | null
  timescale: number
  chapterTrackIds: number[]
  stbl: Box | null
}

async function readBox(source: ByteSource, offset: number, limit: number): Promise<Box | null> {
  if (offset + 8 > limit) {
    return null
  }

  const header = await source.read(offset, 16)

  if (header.length < 8) {
    return null
  }

  const size32 = uint32(header, 0)
  const type = ascii(header, 4, 4)
  let size = size32
  let payload = offset + 8

  if (size32 === 1) {
    size = uint64(header, 8)
    payload = offset + 16
  } else if (size32 === 0) {
    size = limit - offset
  }

  if (size < payload - offset) {
    return null
  }

  return { type, start: offset, payload, end: Math.min(limit, offset + size) }
}

async function children(source: ByteSource, parent: { payload: number; end: number }) {
  const boxes: Box[] = []
  let offset = parent.payload

  while (offset < parent.end) {
    const box = await readBox(source, offset, parent.end)

    if (!box || box.end <= offset) {
      break
    }

    boxes.push(box)
    offset = box.end
  }

  return boxes
}

async function child(source: ByteSource, parent: Box | null, type: string) {
  if (!parent) {
    return null
  }

  return (await children(source, parent)).find((box) => box.type === type) ?? null
}

async function payloadOf(source: ByteSource, box: Box) {
  return source.read(box.payload, box.end - box.payload)
}

/** Movie duration from `mvhd`, in seconds. */
function movieDuration(bytes: Uint8Array) {
  const version = bytes[0]
  const timescale = version === 1 ? uint32(bytes, 20) : uint32(bytes, 12)
  const duration = version === 1 ? uint64(bytes, 24) : uint32(bytes, 16)

  return timescale > 0 ? duration / timescale : null
}

/** Nero chapters: a flat list of 100ns start times and titles in `moov/udta/chpl`. */
export function parseChpl(bytes: Uint8Array): MediaChapter[] {
  const version = bytes[0] ?? 0
  let offset = version === 1 ? 8 : 4
  const count = bytes[offset] ?? 0
  const chapters: MediaChapter[] = []

  offset += 1

  for (let index = 0; index < count && offset + 9 <= bytes.length; index += 1) {
    const start = uint64(bytes, offset) / 10_000_000
    const length = bytes[offset + 8] ?? 0

    chapters.push({ title: trimText(utf8(bytes.subarray(offset + 9, offset + 9 + length))), start })
    offset += 9 + length
  }

  return chapters
}

async function readTrack(source: ByteSource, trak: Box): Promise<Track | null> {
  const boxes = await children(source, trak)
  const tkhd = boxes.find((box) => box.type === 'tkhd')
  const mdia = boxes.find((box) => box.type === 'mdia') ?? null

  if (!tkhd || !mdia) {
    return null
  }

  const header = await source.read(tkhd.payload, 24)
  const id = header[0] === 1 ? uint32(header, 20) : uint32(header, 12)
  const chapterTrackIds: number[] = []
  const chap = await child(source, boxes.find((box) => box.type === 'tref') ?? null, 'chap')

  if (chap) {
    const references = await payloadOf(source, chap)

    for (let offset = 0; offset + 4 <= references.length; offset += 4) {
      chapterTrackIds.push(uint32(references, offset))
    }
  }

  const mdiaBoxes = await children(source, mdia)
  const mdhd = mdiaBoxes.find((box) => box.type === 'mdhd')
  const hdlr = mdiaBoxes.find((box) => box.type === 'hdlr')
  const minf = mdiaBoxes.find((box) => box.type === 'minf') ?? null
  let timescale = 0

  if (mdhd) {
    const bytes = await source.read(mdhd.payload, 24)

    timescale = bytes[0] === 1 ? uint32(bytes, 20) : uint32(bytes, 12)
  }

  const handler = hdlr ? ascii(await source.read(hdlr.payload + 8, 4), 0, 4) : null

  return { id, handler, timescale, chapterTrackIds, stbl: await child(source, minf, 'stbl') }
}

type SampleTables = {
  durations: number[]
  sizes: number[]
  offsets: number[]
}

/** Sample start offsets from the chunk tables, as a player would locate them. */
export function sampleLayout(
  stts: Uint8Array,
  stsz: Uint8Array,
  stsc: Uint8Array,
  chunkOffsets: number[],
): SampleTables {
  const durations: number[] = []

  for (let entry = 0, offset = 8; entry < uint32(stts, 4); entry += 1, offset += 8) {
    const count = uint32(stts, offset)
    const delta = uint32(stts, offset + 4)

    for (let sample = 0; sample < count; sample += 1) {
      durations.push(delta)
    }
  }

  const uniformSize = uint32(stsz, 4)
  const sampleCount = uint32(stsz, 8)
  const sizes: number[] = []

  for (let sample = 0; sample < sampleCount; sample += 1) {
    sizes.push(uniformSize || uint32(stsz, 12 + sample * 4))
  }

  const runs: { firstChunk: number; samplesPerChunk: number }[] = []

  for (let entry = 0, offset = 8; entry < uint32(stsc, 4); entry += 1, offset += 12) {
    runs.push({ firstChunk: uint32(stsc, offset), samplesPerChunk: uint32(stsc, offset + 4) })
  }

  const offsets: number[] = []
  let sample = 0

  for (let chunk = 1; chunk <= chunkOffsets.length && sample < sampleCount; chunk += 1) {
    let perChunk = 0

    for (const run of runs) {
      if (run.firstChunk <= chunk) {
        perChunk = run.samplesPerChunk
      }
    }

    let position = chunkOffsets[chunk - 1] ?? 0

    for (let index = 0; index < perChunk && sample < sampleCount; index += 1) {
      offsets.push(position)
      position += sizes[sample] ?? 0
      sample += 1
    }
  }

  return { durations, sizes, offsets }
}

/** A QuickTime text sample: a 16-bit length, then UTF-8 or BOM-marked UTF-16 text. */
export function textSample(bytes: Uint8Array) {
  const length = uint16(bytes, 0)
  const text = bytes.subarray(2, 2 + length)

  return trimText(text[0] === 0xfe && text[1] === 0xff ? utf16(text) : utf8(text))
}

async function quickTimeChapters(source: ByteSource, track: Track) {
  if (!track.stbl || track.timescale <= 0) {
    return []
  }

  const boxes = await children(source, track.stbl)

  const table = async (type: string) => {
    const box = boxes.find((item) => item.type === type)

    return box ? payloadOf(source, box) : null
  }

  const [stts, stsz, stsc, stco, co64] = await Promise.all([
    table('stts'),
    table('stsz'),
    table('stsc'),
    table('stco'),
    table('co64'),
  ])

  if (!stts || !stsz || !stsc || (!stco && !co64)) {
    return []
  }

  const chunkOffsets: number[] = []

  if (co64) {
    for (let index = 0; index < uint32(co64, 4); index += 1) {
      chunkOffsets.push(uint64(co64, 8 + index * 8))
    }
  } else if (stco) {
    for (let index = 0; index < uint32(stco, 4); index += 1) {
      chunkOffsets.push(uint32(stco, 8 + index * 4))
    }
  }

  const layout = sampleLayout(stts, stsz, stsc, chunkOffsets)
  const chapters: MediaChapter[] = []
  let time = 0

  for (let index = 0; index < layout.offsets.length; index += 1) {
    const bytes = await source.read(layout.offsets[index] ?? 0, layout.sizes[index] ?? 0)

    chapters.push({ title: textSample(bytes), start: time / track.timescale })
    time += layout.durations[index] ?? 0
  }

  return chapters
}

/**
 * Chapters and duration of an MP4/M4B/M4A file. Only the `moov` metadata is read: the audio
 * track's sample tables are skipped, and a QuickTime chapter track wins over Nero `chpl` because
 * it is what Apple players and most encoders treat as authoritative.
 */
export async function readMp4(source: ByteSource): Promise<MediaInfo> {
  const size = (await source.size()) ?? Number.MAX_SAFE_INTEGER
  let moov: Box | null = null
  let offset = 0

  while (offset < size) {
    const box = await readBox(source, offset, size)

    if (!box || box.end <= offset) {
      break
    }

    if (box.type === 'moov') {
      moov = box
      break
    }

    offset = box.end
  }

  if (!moov) {
    return { duration: null, chapters: [] }
  }

  const boxes = await children(source, moov)
  const mvhd = boxes.find((box) => box.type === 'mvhd')
  const duration = mvhd ? movieDuration(await payloadOf(source, mvhd)) : null
  const tracks: Track[] = []

  for (const trak of boxes.filter((box) => box.type === 'trak')) {
    const track = await readTrack(source, trak)

    if (track) {
      tracks.push(track)
    }
  }

  const referenced = new Set(tracks.flatMap((track) => track.chapterTrackIds))
  const chapterTrack = tracks.find((track) => referenced.has(track.id) && track.handler !== 'soun')

  // A chapter track too large for the read budget must not cost the duration or the Nero
  // fallback. Failed requests still throw, so a transient error is retried rather than cached.
  if (chapterTrack) {
    const chapters = await quickTimeChapters(source, chapterTrack).catch((error: Error) => {
      if (error instanceof ReadBudgetExceededError) {
        return []
      }

      throw error
    })

    if (chapters.length > 0) {
      return { duration, chapters }
    }
  }

  const chpl = await child(source, boxes.find((box) => box.type === 'udta') ?? null, 'chpl')

  return { duration, chapters: chpl ? parseChpl(await payloadOf(source, chpl)) : [] }
}
