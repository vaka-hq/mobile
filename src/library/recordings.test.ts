import { describe, expect, it, vi } from 'vitest'
import type { AbbFeed } from '@/sources/audiobookbay/client'
import type { AbbBook, AbbListing } from '@/sources/audiobookbay/parse'
import type { HardcoverRecording } from '@/sources/hardcover/client'
import {
  defaultStreamId,
  findRecordingListings,
  groupByNarrator,
  isRecordingOf,
  postedTitle,
  releaseNotes,
} from './recordings'

const martian = {
  title: 'The Martian',
  subtitle: null,
  authors: ['Andy Weir'],
}

function recording(
  editionId: number,
  narrators: string[],
  language: string | null,
  usersCount: number,
  coverUrl: string | null = null,
): HardcoverRecording {
  return {
    editionId,
    title: 'The Martian',
    format: 'Audible',
    narrators,
    language,
    durationSeconds: 39_540,
    releaseDate: null,
    publisher: null,
    coverUrl,
    coverColor: null,
    coverAspect: null,
    isbn13: null,
    asin: null,
    usersCount,
  }
}

const recordings = [
  recording(1, ['Wil Wheaton'], null, 34),
  recording(2, ['Wil Wheaton'], 'English', 28, 'https://covers/wheaton.jpg'),
  recording(3, ['R.C. Bray'], 'English', 25, 'https://covers/bray.jpg'),
  recording(4, ['Richard Barenberg'], 'German', 6),
]

function post(
  id: string,
  narrator: string | null,
  format: string,
  postedAt: string,
  title = 'The Martian',
): AbbBook {
  return {
    parser: 2,
    id,
    title,
    author: 'Andy Weir',
    narrator,
    coverUrl: null,
    description: [],
    categories: [],
    language: 'English',
    format,
    bitrate: null,
    abridged: false,
    postedAt,
    infoHash: id.padEnd(40, '0'),
    trackers: [],
    files: [],
    totalSize: null,
  }
}

describe('uploads of a Hardcover book', () => {
  it('keeps uploads of the book and drops namesakes, prequels and collections', () => {
    const accepted = [
      { title: 'The Martian', author: 'Andy Weir' },
      { title: 'The Martian (Read by Wil Wheaton) [FIXED]', author: 'Andy Weir' },
      {
        title:
          'The Martian (All Sources! Read by R.C. Bray with Bonus by Wil Wheaton) FULLY CHAPTERIZED',
        author: 'Andy Weir',
      },
      { title: 'The Martian', author: 'Any Weir' },
    ]

    const rejected = [
      { title: 'The Martian Chronicles', author: 'Ray Bradbury' },
      { title: 'Diary of an Asscan: The Martian Prequel', author: 'Andy Weir' },
      {
        title: 'Andy Weir - Complete Collection - 3 Novels and 14 Short Stories',
        author: 'Andy Weir',
      },
      { title: 'Project Hail Mary', author: 'Andy Weir' },
      { title: 'The Martian Contingency', author: 'Mary Robinette Kowal' },
    ]

    expect(accepted.every((item) => isRecordingOf(item, martian))).toBe(true)
    expect(rejected.some((item) => isRecordingOf(item, martian))).toBe(false)
  })

  it('matches posts that spell a punctuated title differently', () => {
    const elevenTwentyTwo = { title: '11/22/63', subtitle: null, authors: ['Stephen King'] }

    expect(
      isRecordingOf({ title: "Stephen King's 11-22-63", author: 'Stephen King' }, elevenTwentyTwo),
    ).toBe(true)
    expect(isRecordingOf({ title: '11-22-63', author: 'Stephen King' }, elevenTwentyTwo)).toBe(true)
    expect(isRecordingOf({ title: '11/22/63', author: 'Stephen King' }, elevenTwentyTwo)).toBe(true)
  })

  it('searches with the short title rather than a Hardcover subtitle', () => {
    expect(
      postedTitle({
        title: 'Atomic Habits: An Easy & Proven Way',
        subtitle: 'An Easy & Proven Way',
      }),
    ).toBe('Atomic Habits')
  })

  it('groups uploads by narrator with the matching Hardcover recording', () => {
    const groups = groupByNarrator(
      { recordings },
      [
        post('a', 'Wil Wheaton', 'MP3', '2020-09-23'),
        post('b', 'R.C. Bray', 'M4B', '2026-05-11'),
        post('c', 'Wil Wheaton', 'M4B', '2021-06-12'),
        post('d', 'Wil Wheaton', 'M4B', '2024-09-15'),
        post('e', null, 'MP3', '2019-01-01'),
        post('f', 'Someone Unknown', 'MP3', '2018-01-01'),
      ],
      'en',
    )

    expect(groups.map((group) => group.narrators)).toEqual([
      ['Wil Wheaton'],
      ['R.C. Bray'],
      ['Someone Unknown'],
      [],
    ])
    // The English edition with a cover represents Wheaton's recording.
    expect(groups[0]?.recording?.editionId).toBe(2)
    // M4B leads, newest first; MP3 follows.
    expect(groups[0]?.posts.map((item) => item.id)).toEqual(['d', 'c', 'a'])
    expect(groups[2]?.recording).toBeNull()
  })

  it('names what sets an upload apart without repeating the narrator credit', () => {
    expect(releaseNotes('The Martian (Read by Wil Wheaton) [FIXED]')).toBe('FIXED')
    expect(releaseNotes('The Martian (Re-Performed, New Ending 2014)')).toBe(
      'Re-Performed, New Ending 2014',
    )
    expect(releaseNotes('The Martian')).toBe('')
  })

  it('reads at most two pages and skips the bare title once enough uploads are found', async () => {
    function listing(id: string, title: string): AbbListing {
      return {
        id,
        title,
        author: 'Andy Weir',
        coverUrl: null,
        categories: [],
        language: 'English',
        format: 'M4B',
        bitrate: null,
        size: null,
        postedAt: null,
      }
    }

    const loadPage = vi.fn(async (_feed: AbbFeed, page: number) => ({
      items: [
        listing(`martian-${page}-a`, 'The Martian'),
        listing(`martian-${page}-b`, 'The Martian (Read by Wil Wheaton)'),
        listing(`hail-mary-${page}`, 'Project Hail Mary'),
      ],
      hasNextPage: true,
    }))

    const found = await findRecordingListings(martian, loadPage)

    expect(found.map((item) => item.id)).toEqual([
      'martian-1-a',
      'martian-1-b',
      'martian-2-a',
      'martian-2-b',
    ])
    expect(loadPage.mock.calls).toEqual([
      [{ kind: 'search', query: 'The Martian Andy Weir' }, 1],
      [{ kind: 'search', query: 'The Martian Andy Weir' }, 2],
    ])
  })

  it('defaults to the best cached source of the most read narrator who has one', () => {
    const low = { ...post('low', 'Wil Wheaton', 'M4B', '2024-01-01'), bitrate: '32 Kbps' }
    const high = { ...post('high', 'Wil Wheaton', 'M4B', '2020-01-01'), bitrate: '128 Kbps' }
    const mp3 = { ...post('mp3', 'Wil Wheaton', 'MP3', '2025-01-01'), bitrate: '320 Kbps' }
    const bray = post('bray', 'R.C. Bray', 'M4B', '2026-01-01')
    const groups = groupByNarrator({ recordings }, [low, mp3, bray, high], 'en')

    expect(groups[0]?.posts.map((item) => item.id)).toEqual(['high', 'low', 'mp3'])
    expect(defaultStreamId(groups, null, 'en')).toBe('high')
    expect(defaultStreamId(groups, new Set([low.infoHash]), 'en')).toBe('low')
    // Another narrator's cached upload beats one TorBox would have to download first.
    expect(defaultStreamId(groups, new Set([bray.infoHash]), 'en')).toBe('bray')
    expect(defaultStreamId(groups, new Set([bray.infoHash, mp3.infoHash]), 'en')).toBe('mp3')
  })

  it('puts recordings in the preferred language first, even over a cached one', () => {
    const english = post('english', 'Wil Wheaton', 'M4B', '2024-01-01')

    const swedish = {
      ...post('swedish', 'Anna Svensson', 'MP3', '2020-01-01'),
      language: 'Swedish',
    }

    const groups = groupByNarrator({ recordings }, [english, swedish], 'sv')

    expect(groups.map((group) => group.posts[0]?.id)).toEqual(['swedish', 'english'])
    expect(defaultStreamId(groups, new Set([english.infoHash]), 'sv')).toBe('swedish')
    // In English, the most read narrator leads as before.
    expect(groupByNarrator({ recordings }, [english, swedish], 'en')[0]?.posts[0]?.id).toBe(
      'english',
    )
  })

  it('ranks the whole book above an abridged upload', () => {
    const abridged = { ...post('abridged', 'Wil Wheaton', 'M4B', '2025-01-01'), abridged: true }
    const whole = post('whole', 'Wil Wheaton', 'MP3', '2020-01-01')
    const groups = groupByNarrator({ recordings }, [abridged, whole], 'en')

    expect(groups[0]?.posts.map((item) => item.id)).toEqual(['whole', 'abridged'])
  })
})
