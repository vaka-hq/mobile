import { describe, expect, it } from 'vitest'
import { defaultAudioBookBayUrl, fetchBook, fetchFeed } from './client'

// Reaches the real site; run with `vp run test:live`.
describe('AudioBookBay (live)', () => {
  it('searches, pages and opens a post with a playable info hash', async () => {
    const page = await fetchFeed(defaultAudioBookBayUrl, { kind: 'search', query: 'andy weir' }, 1)

    expect(page.items.length).toBeGreaterThan(0)

    const book = await fetchBook(defaultAudioBookBayUrl, page.items[0]?.id ?? '')

    expect(book.infoHash).toMatch(/^[0-9a-f]{40}$/u)
    expect(book.trackers.length).toBeGreaterThan(0)
  }, 30_000)

  it('browses the latest uploads and a category', async () => {
    const latest = await fetchFeed(defaultAudioBookBayUrl, { kind: 'latest' }, 2)

    const category = await fetchFeed(
      defaultAudioBookBayUrl,
      { kind: 'category', slug: 'sci-fi' },
      1,
    )

    expect(latest.items.length).toBeGreaterThan(0)
    expect(category.items.every((item) => item.id.length > 0)).toBe(true)
  }, 30_000)
})
