import { describe, expect, it } from 'vitest'
import { feedUrl, normalizeBaseUrl, searchTerms } from './client'

describe('AudioBookBay URLs', () => {
  it('normalizes configured mirrors', () => {
    expect(normalizeBaseUrl('audiobookbay.lu/')).toBe('https://audiobookbay.lu')
    expect(normalizeBaseUrl(' https://audiobookbay.is/path ')).toBe('https://audiobookbay.is')
  })

  it('builds paged latest, category and search listings', () => {
    const base = 'https://audiobookbay.lu'

    expect(feedUrl(base, { kind: 'latest' }, 1)).toBe('https://audiobookbay.lu/')
    expect(feedUrl(base, { kind: 'latest' }, 3)).toBe('https://audiobookbay.lu/page/3/')
    expect(feedUrl(base, { kind: 'category', slug: 'sci-fi' }, 2)).toBe(
      'https://audiobookbay.lu/audio-books/type/sci-fi/page/2/',
    )
    expect(feedUrl(base, { kind: 'search', query: ' Project Hail Mary ' }, 2)).toBe(
      'https://audiobookbay.lu/page/2/?s=project+hail+mary&cat=undefined%2Cundefined',
    )
    expect(feedUrl(base, { kind: 'search', query: '11/22/63 Stephen King' }, 1)).toBe(
      'https://audiobookbay.lu/?s=11+22+63+stephen+king&cat=undefined%2Cundefined',
    )
  })
})

describe('AudioBookBay search terms', () => {
  it('turns punctuation into spaces and keeps apostrophes', () => {
    expect(searchTerms('11/22/63')).toBe('11 22 63')
    expect(searchTerms("Harry Potter and the Philosopher's Stone")).toBe(
      "harry potter and the philosopher's stone",
    )
    expect(searchTerms('Dune: Messiah — Book 2')).toBe('dune messiah book 2')
  })
})
