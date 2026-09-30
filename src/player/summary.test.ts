import { describe, expect, it } from 'vitest'
import type { BookRecord } from '@/library/model'
import { listeningProgress, summarize } from './summary'

const book: BookRecord = {
  id: 'book',
  abb: {
    parser: 2,
    id: 'book',
    title: 'Book',
    author: null,
    narrator: null,
    coverUrl: null,
    description: [],
    categories: [],
    language: null,
    format: 'MP3',
    bitrate: null,
    abridged: null,
    postedAt: null,
    infoHash: 'a'.repeat(40),
    trackers: [],
    files: [],
    totalSize: null,
  },
  abbFetchedAt: 0,
  hardcoverId: null,
  hardcover: null,
  matchState: 'pending',
  torrentId: 1,
  tracks: [
    { fileId: 1, name: '1.mp3', title: 'One', size: 1, format: 'mp3' },
    { fileId: 2, name: '2.mp3', title: 'Two', size: 1, format: 'mp3' },
  ],
  durations: [600, null],
  chapters: [
    { title: 'Intro', track: 0, start: 0 },
    { title: 'Part 1', track: 0, start: 100 },
    { title: '', track: 1, start: 0 },
  ],
  lastPlayedAt: 1,
}

describe('playback summary', () => {
  it('locates the chapter and book position', () => {
    expect(summarize(book, 0, 250, 600)).toEqual({
      chapterIndex: 1,
      chapterCount: 3,
      chapterTitle: 'Part 1',
      chapterElapsed: 150,
      chapterLength: 500,
      bookElapsed: 250,
      bookTotal: null,
    })
  })

  it('uses the playing track length until it is stored', () => {
    const summary = summarize(book, 1, 30, 400)

    expect(summary.chapterTitle).toBeNull()
    expect(summary.chapterLength).toBe(400)
    expect(summary.bookElapsed).toBe(630)
    expect(summary.bookTotal).toBe(1000)
  })

  it('reports library progress only once the length is known', () => {
    const playback = {
      bookId: 'book',
      track: 0,
      position: 300,
      speed: 1,
      finished: false,
      updatedAt: 0,
    }

    expect(listeningProgress(book, playback)).toBeNull()
    expect(listeningProgress({ ...book, durations: [600, 400] }, playback)).toBe(0.3)
    expect(listeningProgress(book, { ...playback, finished: true })).toBe(1)
    expect(listeningProgress(book, null)).toBeNull()
  })
})
