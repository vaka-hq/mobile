import { describe, expect, it } from 'vitest'
import { rankEbooks } from './ebook-rank'
import type { EbookResult } from './ebooks'
import { byPreferredLanguage, compareLanguages, languageCode } from './languages'

function file(md5: string, overrides: Partial<EbookResult>): EbookResult {
  return {
    md5,
    source: 'libgen',
    title: 'Project Hail Mary',
    authors: ['Andy Weir'],
    publisher: null,
    year: '2021',
    language: 'English',
    extension: 'epub',
    size: '5 MB',
    coverUrl: null,
    isbns: [],
    ...overrides,
  }
}

const book = { title: 'Project Hail Mary', authors: ['Andy Weir'] }

describe('rankEbooks', () => {
  it('puts the book by its author first', () => {
    const ranked = rankEbooks(
      [file('a', { authors: ['Someone Else'], title: 'Hail Mary notes' }), file('b', {})],
      book,
      'en',
    )

    expect(ranked.map((result) => result.md5)).toEqual(['b', 'a'])
  })

  it('puts the preferred language first, then English, then the others by name', () => {
    const files = [
      file('es', { language: 'Spanish' }),
      file('none', { language: null }),
      file('de', { language: 'German' }),
      file('en', {}),
      file('sv', { language: 'Svenska' }),
    ]

    expect(rankEbooks(files, book, 'sv').map((result) => result.md5)).toEqual([
      'sv',
      'en',
      'de',
      'es',
      'none',
    ])
    expect(rankEbooks(files, book, 'en').map((result) => result.md5)).toEqual([
      'en',
      'de',
      'es',
      'sv',
      'none',
    ])
  })

  it('keeps a file by another author after the book, whatever its language', () => {
    const ranked = rankEbooks(
      [file('other', { authors: ['Someone Else'], language: 'Swedish' }), file('book', {})],
      book,
      'sv',
    )

    expect(ranked.map((result) => result.md5)).toEqual(['book', 'other'])
  })

  it('passes over stubs and keeps the sites’ order otherwise', () => {
    const ranked = rankEbooks(
      [file('stub', { size: '12 kB' }), file('first', {}), file('second', { size: '1.2 MB' })],
      book,
      'en',
    )

    expect(ranked.map((result) => result.md5)).toEqual(['first', 'second', 'stub'])
  })

  it('matches authors without accents or punctuation', () => {
    const ranked = rankEbooks(
      [
        file('other', { authors: ['Anon'] }),
        file('accented', { authors: ['Gabriel García Márquez'] }),
      ],
      { title: 'One Hundred Years of Solitude', authors: ['Gabriel Garcia Marquez'] },
      'en',
    )

    expect(ranked[0]?.md5).toBe('accented')
  })
})

describe('languages', () => {
  it('reads the names and codes the sites use', () => {
    expect(languageCode('English')).toBe('en')
    expect(languageCode('English [en]')).toBe('en')
    expect(languageCode('Español')).toBe('es')
    expect(languageCode('ger')).toBe('de')
    expect(languageCode('English; Spanish')).toBe('en')
    expect(languageCode('Klingon')).toBeNull()
    expect(languageCode(null)).toBeNull()
  })

  it('orders a search by language alone, keeping the sites’ order within each', () => {
    const ordered = byPreferredLanguage(
      [
        file('fr', { language: 'French' }),
        file('en1', {}),
        file('es', { language: 'Spanish' }),
        file('en2', {}),
      ],
      'es',
    )

    expect(ordered.map((result) => result.md5)).toEqual(['es', 'en1', 'en2', 'fr'])
    expect(compareLanguages('en')('Danish', 'Czech')).toBeGreaterThan(0)
  })
})
