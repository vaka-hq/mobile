import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { magnetLink, narratorFromLines, parseBookPage, parseListingPage, splitTitle } from './parse'

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

describe('AudioBookBay listings', () => {
  it('reads every post with its slug, author and release details', () => {
    const page = parseListingPage(fixture('search.html'))

    expect(page.hasNextPage).toBe(true)
    expect(page.items).toHaveLength(9)
    expect(page.items[0]).toEqual({
      id: 'getv-lost-justin-halpern',
      title: 'Get Lost',
      author: 'Justin Halpern',
      coverUrl: 'https://m.media-amazon.com/images/I/411HkEdGmkL._SL500_.jpg',
      categories: ['Humor', 'Mystery'],
      language: 'English',
      format: 'M4B',
      bitrate: '?',
      size: '205.01 MBs',
      postedAt: '12 Jul 2026',
    })
  })

  it('keeps hyphenated titles and splits at the last separator', () => {
    expect(splitTitle('Andy Weir - Complete Collection - Andy Weir')).toEqual({
      title: 'Andy Weir - Complete Collection',
      author: 'Andy Weir',
    })
    expect(splitTitle('Untitled')).toEqual({ title: 'Untitled', author: null })
  })
})

describe('AudioBookBay book pages', () => {
  it('reads the torrent, credits and description of a single-file book', () => {
    const book = parseBookPage(fixture('book-m4b.html'), 'getv-lost-justin-halpern')

    expect(book).toMatchObject({
      title: 'Get Lost',
      author: 'Justin Halpern',
      narrator: 'Katherine Littrell',
      format: 'M4B',
      abridged: false,
      language: 'English',
      categories: ['Humor', 'Mystery'],
      postedAt: '2026-07-12',
      infoHash: 'a75c81a1ea997530087d87dec83bf77a1dddee15',
      files: [{ name: 'Get_Lost.m4b', size: '205.01 MBs' }],
      totalSize: '205.01 MBs',
    })
    expect(book.trackers).toContain('udp://tracker.opentrackr.org:1337/announce')
    expect(new Set(book.trackers).size).toBe(book.trackers.length)
    expect(book.description[0]).toMatch(/^From the author of the #1 New York Times/u)
    expect(book.description.join(' ')).not.toMatch(/Written by/u)
  })

  it('lists every file of a multi-file book', () => {
    const book = parseBookPage(fixture('book-mp3.html'), 'projectt-hail-mary-mp3-andy-weir')

    expect(book.format).toBe('MP3')
    expect(book.bitrate).toBe('128 Kbps')
    expect(book.narrator).toBe('Ray Porter')
    expect(book.files.filter((file) => file.name.endsWith('.mp3')).length).toBeGreaterThan(20)
    expect(book.files[0]).toEqual({ name: '2021 - Project Hail Mary cover.jpg', size: '58.56 KBs' })
  })

  it('builds a magnet link with every tracker', () => {
    const magnet = magnetLink({
      infoHash: 'a75c81a1ea997530087d87dec83bf77a1dddee15',
      title: 'Get Lost',
      trackers: ['udp://a:1/announce', 'http://b/announce'],
    })

    expect(magnet).toBe(
      'magnet:?xt=urn:btih:a75c81a1ea997530087d87dec83bf77a1dddee15&dn=Get%20Lost&tr=udp%3A%2F%2Fa%3A1%2Fannounce&tr=http%3A%2F%2Fb%2Fannounce',
    )
  })

  it('rejects pages without an info hash', () => {
    expect(() => parseBookPage('<div class="post"></div>', 'x')).toThrow('info hash')
  })

  it('finds a narrator credited in a description paragraph', () => {
    // As on /abss/proaject-hail-mary-andy-weir/: no narrator field, a "Narrator:" paragraph.
    const html = fixture('book-mp3.html')
      .replace(
        /Read by <a href="\/\?s=ray\+porter"><span class="narrator"[^>]*>Ray Porter<\/span><\/a> <br \/>/u,
        '',
      )
      .replace(
        '<div class="desc" itemprop="description">',
        '<div class="desc" itemprop="description"><p>Narrator: Ray Porter</p>',
      )

    expect(html).not.toContain('class="narrator"')
    expect(parseBookPage(html, 'proaject-hail-mary-andy-weir').narrator).toBe('Ray Porter')
  })

  it('reads credits written as plain lines in posts without a description block', () => {
    // As on /abss/blood-aof-elves-andrzej-sapkowski/: an older post whose credits are the lines
    // of its description paragraph, with no .desc block or labelled spans.
    const book = parseBookPage(
      fixture('book-plain-credits.html'),
      'blood-aof-elves-andrzej-sapkowski',
    )

    expect(book.narrator).toBe('Peter Kenny')
    expect(book.format).toBe('MP3')
    expect(book.bitrate).toBe('32 Kbps')
    expect(book.abridged).toBe(false)
    expect(book.description[0]).toMatch(/^Blood of Elves is an English translation/u)
    expect(book.description.join(' ')).not.toMatch(/Written by|Shared by/u)
  })

  it('reads labelled spans outside a description block', () => {
    // As on /abss/the-hwitcher-1-blood-of-elves-fixed-andrzej-sapkowski/: the format and bitrate
    // spans sit in the post body, and no narrator is credited.
    const book = parseBookPage(
      fixture('book-bare-spans.html'),
      'the-hwitcher-1-blood-of-elves-fixed-andrzej-sapkowski',
    )

    expect(book.author).toBe('Andrzej Sapkowski')
    expect(book.narrator).toBeNull()
    expect(book.format).toBe('MP3')
    expect(book.bitrate).toBe('32 Kbps')
    expect(book.description.some((text) => text.startsWith('Watch for the signs!'))).toBe(true)
  })

  it('reads credit lines but not reviews or sentences', () => {
    expect(narratorFromLines(['Narrator: Ray Porter'])).toBe('Ray Porter')
    expect(narratorFromLines(['Narrated by R.C. Bray'])).toBe('R.C. Bray')
    expect(narratorFromLines(['Read by: Wil Wheaton with a bonus by R.C. Bray'])).toBe(
      'Wil Wheaton',
    )
    expect(
      narratorFromLines(['Ray Porter is a great narrator.', 'Readers love this book']),
    ).toBeNull()
  })
})
