import { describe, expect, it } from 'vitest'
import { mp3Duration, parseId3, readMp3 } from './mp3'
import { readMp4 } from './mp4'
import { memorySource } from './source'

function concat(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0

  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }

  return bytes
}

function u8(...values: number[]) {
  return new Uint8Array(values)
}

function u16(value: number) {
  return u8(value >>> 8, value & 0xff)
}

function u32(value: number) {
  return u8(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function u64(value: number) {
  return concat(u32(Math.floor(value / 0x100000000)), u32(value % 0x100000000))
}

function text(value: string) {
  return new TextEncoder().encode(value)
}

function box(type: string, ...payload: Uint8Array[]) {
  const body = concat(...payload)

  return concat(u32(body.length + 8), text(type), body)
}

function fullBox(type: string, ...payload: Uint8Array[]) {
  return box(type, u32(0), ...payload)
}

function trackHeader(id: number) {
  return fullBox('tkhd', u32(0), u32(0), u32(id), u32(0), u32(0))
}

function mediaHeader(timescale: number) {
  return fullBox('mdhd', u32(0), u32(0), u32(timescale), u32(0))
}

function handler(type: string) {
  return fullBox('hdlr', u32(0), text(type), u32(0), u32(0), u32(0), u8(0))
}

function movieHeader(timescale: number, duration: number) {
  return fullBox('mvhd', u32(0), u32(0), u32(timescale), u32(duration))
}

function sample(title: string) {
  const bytes = text(title)

  return concat(u16(bytes.length), bytes)
}

/** An M4B shaped like encoder output: ftyp, mdat with chapter text samples, then moov. */
function m4b(titles: string[], durations: number[], withChpl: boolean) {
  const ftyp = box('ftyp', text('M4B '), u32(0))
  const samples = titles.map(sample)
  const mdat = box('mdat', ...samples)
  const firstSample = ftyp.length + 8
  const chunkOffsets: number[] = []
  let offset = firstSample

  for (const item of samples) {
    chunkOffsets.push(offset)
    offset += item.length
  }

  const chapterTrack = box(
    'trak',
    trackHeader(2),
    box(
      'mdia',
      mediaHeader(1000),
      handler('text'),
      box(
        'minf',
        box(
          'stbl',
          fullBox(
            'stts',
            u32(durations.length),
            ...durations.flatMap((duration) => [u32(1), u32(duration)]),
          ),
          fullBox('stsz', u32(0), u32(samples.length), ...samples.map((item) => u32(item.length))),
          fullBox('stsc', u32(1), u32(1), u32(1), u32(1)),
          fullBox('stco', u32(chunkOffsets.length), ...chunkOffsets.map(u32)),
        ),
      ),
    ),
  )

  const audioTrack = box(
    'trak',
    trackHeader(1),
    box('tref', box('chap', u32(2))),
    box('mdia', mediaHeader(44100), handler('soun'), box('minf', box('stbl'))),
  )

  // mp4v2 writes version 1: one reserved byte and a 32-bit count whose low byte is read.
  const chpl = box(
    'chpl',
    u32(0x01000000),
    u8(0),
    u32(2),
    u64(0),
    u8(4),
    text('Nero'),
    u64(600_000_000),
    u8(5),
    text('Later'),
  )

  const moov = box(
    'moov',
    movieHeader(
      1000,
      durations.reduce((total, duration) => total + duration, 0),
    ),
    audioTrack,
    ...(withChpl ? [] : [chapterTrack]),
    box('udta', chpl),
  )

  return concat(ftyp, mdat, moov)
}

describe('MP4 chapters', () => {
  it('reads QuickTime chapter tracks with their start times', async () => {
    const file = m4b(['Opening Credits', 'Chapter 1', 'Chapter 2'], [5000, 120_000, 90_500], false)
    const info = await readMp4(memorySource(file))

    expect(info.duration).toBe(215.5)
    expect(info.chapters).toEqual([
      { title: 'Opening Credits', start: 0 },
      { title: 'Chapter 1', start: 5 },
      { title: 'Chapter 2', start: 125 },
    ])
  })

  it('falls back to Nero chapters', async () => {
    const info = await readMp4(memorySource(m4b(['Unused'], [1000], true)))

    expect(info.chapters).toEqual([
      { title: 'Nero', start: 0 },
      { title: 'Later', start: 60 },
    ])
  })

  it('returns no chapters for files without a movie box', async () => {
    const info = await readMp4(memorySource(box('ftyp', text('M4A '))))

    expect(info).toEqual({ duration: null, chapters: [] })
  })
})

function id3Frame(id: string, body: Uint8Array) {
  return concat(text(id), u32(body.length), u16(0), body)
}

function syncsafe(value: number) {
  return u8((value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f)
}

function id3(...frames: Uint8Array[]) {
  const body = concat(...frames)

  return concat(text('ID3'), u8(3, 0, 0), syncsafe(body.length), body)
}

function chapter(id: string, start: number, end: number, title: string) {
  return id3Frame(
    'CHAP',
    concat(
      text(id),
      u8(0),
      u32(start),
      u32(end),
      u32(0xffffffff),
      u32(0xffffffff),
      id3Frame('TIT2', concat(u8(3), text(title))),
    ),
  )
}

/** An MPEG-1 Layer III frame header with a Xing frame count (stereo, 128 kbps, 44.1 kHz). */
function xingFrame(frames: number) {
  return concat(u8(0xff, 0xfb, 0x90, 0x00), new Uint8Array(32), text('Xing'), u32(1), u32(frames))
}

describe('MP3 chapters and duration', () => {
  it('reads ID3v2 CHAP frames in start order', () => {
    const tag = parseId3(
      id3(chapter('ch1', 61_500, 90_000, 'Second'), chapter('ch0', 0, 61_500, 'First')),
    )

    expect(tag?.chapters).toEqual([
      { title: 'First', start: 0 },
      { title: 'Second', start: 61.5 },
    ])
  })

  it('computes exact VBR duration from the Xing header', () => {
    expect(mp3Duration(xingFrame(38_281), 0)).toBeCloseTo(1000, 0)
  })

  it('estimates constant bitrate duration from the file size', () => {
    const frame = concat(u8(0xff, 0xfb, 0x90, 0x00), new Uint8Array(64))

    expect(mp3Duration(frame, 16_000_000)).toBe(1000)
  })

  it('reads a whole tagged file', async () => {
    const file = concat(id3(chapter('a', 0, 1000, 'Only')), xingFrame(3828))
    const info = await readMp3(memorySource(file))

    expect(info.chapters).toEqual([{ title: 'Only', start: 0 }])
    expect(info.duration).toBeCloseTo(100, 0)
  })
})
