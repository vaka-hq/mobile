import { describe, expect, it } from 'vitest'
import {
  bestMatch,
  type HardcoverHit,
  normalize,
  pickEdition,
  rankMatches,
  searchableTitle,
} from './match'

function hit(id: number, title: string, authors: string[], usersCount = 0): HardcoverHit {
  return {
    id,
    title,
    subtitle: null,
    authors,
    coverUrl: null,
    coverColor: null,
    coverAspect: null,
    releaseYear: null,
    series: null,
    usersCount,
  }
}

describe('Hardcover matching', () => {
  it('strips release noise from AudioBookBay titles', () => {
    expect(searchableTitle('The Way of Kings (The Stormlight Archive, Book 1) [Unabridged]')).toBe(
      'The Way of Kings',
    )
    expect(searchableTitle('Project Hail Mary MP3 128kbps')).toBe('Project Hail Mary')
    expect(normalize('Ender’s Game & Café')).toBe('enders game and cafe')
  })

  it('prefers the title and author that match the listing', () => {
    const hits = [
      hit(1, 'Project Hail Mary: A Novel Study', ['Some Teacher'], 5),
      hit(2, 'Project Hail Mary', ['Andy Weir'], 90_000),
      hit(3, 'Hail Mary', ['Someone Else'], 100),
    ]

    expect(bestMatch(hits, 'Project Hail Mary', 'Andy Weir')?.id).toBe(2)
    expect(rankMatches(hits, 'Project Hail Mary', 'Andy Weir')[0]?.score).toBeCloseTo(1)
  })

  it('declines weak matches instead of guessing', () => {
    expect(bestMatch([hit(1, 'Dune', ['Frank Herbert'])], 'Get Lost', 'Justin Halpern')).toBeNull()
  })

  it('breaks ties by popularity', () => {
    const hits = [hit(1, 'Dune', ['Frank Herbert'], 10), hit(2, 'Dune', ['Frank Herbert'], 900)]

    expect(bestMatch(hits, 'Dune', 'Frank Herbert')?.id).toBe(2)
  })
})

describe('audiobook editions', () => {
  const bray = {
    id: 1,
    narrators: ['R.C. Bray'],
    language: 'English',
    hasCover: true,
    usersCount: 25,
  }

  const wheaton = {
    id: 2,
    narrators: ['Wil Wheaton'],
    language: 'English',
    hasCover: true,
    usersCount: 28,
  }

  const wheatonBare = {
    id: 3,
    narrators: ['Wil Wheaton'],
    language: null,
    hasCover: false,
    usersCount: 34,
  }

  const german = {
    id: 4,
    narrators: ['Richard Barenberg'],
    language: 'German',
    hasCover: true,
    usersCount: 6,
  }

  const editions = [wheatonBare, wheaton, bray, german]

  it('picks the recording by the posted narrator, preferring language and cover art', () => {
    expect(pickEdition(editions, bray, 'Wil Wheaton', 'English')?.id).toBe(2)
  })

  it('keeps the default edition when the narrator is unknown or unmatched', () => {
    expect(pickEdition(editions, bray, null, 'English')?.id).toBe(1)
    expect(pickEdition(editions, bray, 'Somebody Else', 'English')?.id).toBe(1)
  })

  it('matches any of several credited narrators', () => {
    expect(pickEdition(editions, bray, 'Jan Francis, R. C. Bray', 'English')?.id).toBe(1)
  })
})
