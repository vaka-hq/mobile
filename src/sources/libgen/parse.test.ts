import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMirrorPage, parsePageCount, parseSearchPage } from './parse'

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

describe('Library Genesis pages', () => {
  it('reads every file of a search with its md5 and details', () => {
    const files = parseSearchPage(fixture('search.html'))

    expect(files.length).toBeGreaterThan(10)
    expect(files[0]).toMatchObject({
      md5: 'f21ef754f3c4b986f3896807d80a6ce1',
      title: 'Project Hail Mary',
      authors: ['Andy Weir'],
      publisher: 'Penguin Random House LLC',
      year: '2021',
      language: 'English',
      extension: 'epub',
      size: '9 MB',
    })
    expect(files[0]?.isbns).toContain('9780593135211')
  })

  it('reads how many pages a search has, and none from a page without page numbers', () => {
    expect(parsePageCount(fixture('search.html'))).toBe(3)
    expect(parsePageCount(fixture('ads.html'))).toBeNull()
  })

  it('finds the keyed download link and the cover on a mirror page', () => {
    const mirror = parseMirrorPage(fixture('ads.html'))

    expect(mirror.download).toMatch(/^get\.php\?md5=ed984db8707f12fe72ae28efa5f3f30f&key=\w+$/u)
    expect(mirror.cover).toMatch(/covers\/.*\.jpg$/u)
  })
})
