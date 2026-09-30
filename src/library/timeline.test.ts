import { describe, expect, it } from 'vitest'
import type { Track } from '@/sources/torbox/tracks'
import {
  bookDuration,
  bookPosition,
  buildChapters,
  chapterEnd,
  chapterIndexAt,
  locate,
  offsetPosition,
} from './timeline'

function track(fileId: number, title: string): Track {
  return { fileId, name: `${title}.mp3`, title, size: 1, format: 'mp3' }
}

describe('book timeline', () => {
  it('uses embedded chapters and falls back to one chapter per file', () => {
    const chapters = buildChapters(
      [track(1, 'Part 1'), track(2, 'Part 2')],
      [
        {
          duration: 100,
          chapters: [
            { title: 'Intro', start: 0 },
            { title: 'One', start: 40 },
          ],
        },
        null,
      ],
    )

    expect(chapters).toEqual([
      { title: 'Intro', track: 0, start: 0 },
      { title: 'One', track: 0, start: 40 },
      { title: 'Part 2', track: 1, start: 0 },
    ])
  })

  it('converts between book time and track offsets', () => {
    const durations = [100, 50, 25]

    expect(bookPosition(durations, 2, 10)).toBe(160)
    expect(locate(durations, 160)).toEqual({ track: 2, position: 10 })
    expect(locate(durations, 1000)).toEqual({ track: 2, position: 25 })
    expect(locate(durations, -5)).toEqual({ track: 0, position: 0 })
    expect(bookDuration(durations)).toBe(175)
    expect(bookDuration([100, null])).toBeNull()
  })

  it('finds the current chapter and where it ends', () => {
    const chapters = [
      { title: 'A', track: 0, start: 0 },
      { title: 'B', track: 0, start: 40 },
      { title: 'C', track: 1, start: 0 },
    ]

    expect(chapterIndexAt(chapters, 0, 39)).toBe(0)
    expect(chapterIndexAt(chapters, 0, 40)).toBe(1)
    expect(chapterIndexAt(chapters, 1, 5)).toBe(2)
    expect(chapterEnd(chapters, 0, [100, 50])).toBe(40)
    expect(chapterEnd(chapters, 1, [100, 50])).toBe(100)
    expect(chapterEnd(chapters, 2, [100, null])).toBeNull()
  })

  it('skips across files only where their lengths are known', () => {
    expect(offsetPosition([100, 50, 25], 1, 10, -30)).toEqual({ track: 0, position: 80 })
    expect(offsetPosition([100, 50, 25], 0, 90, 30)).toEqual({ track: 1, position: 20 })
    expect(offsetPosition([100, 50, 25], 2, 20, 30)).toEqual({ track: 2, position: 25 })
    expect(offsetPosition([null, null, 600], 2, 100, -15)).toEqual({ track: 2, position: 85 })
    expect(offsetPosition([null, null, 600], 2, 10, -15)).toEqual({ track: 2, position: 0 })
    expect(offsetPosition([null, 50], 0, 500, 30)).toEqual({ track: 0, position: 530 })
  })
})
