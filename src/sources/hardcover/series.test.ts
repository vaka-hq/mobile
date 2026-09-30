import { describe, expect, it } from 'vitest'
import { seriesBooks } from './series'

function entry(position: number | null, title: string, usersCount: number, extra = {}) {
  return { position, compilation: false, canonicalId: null, usersCount, book: title, ...extra }
}

describe('series books', () => {
  it('keeps one book per position in reading order without duplicates or omnibus editions', () => {
    const books = seriesBooks([
      entry(2, "Caliban's War", 3564),
      entry(1, 'Leviathan Wakes', 6651),
      entry(1, 'Leviathan Wakes (duplicate record)', 0, { canonicalId: 427621 }),
      entry(1, 'Leviathan Wakes / The Dragon’s Path', 0, { compilation: true }),
      entry(1.5, 'The Butcher of Anderson Station', 1215),
      entry(6, 'Babylons Asche', 5),
      entry(6, "Babylon's Ashes", 2459),
      entry(null, "Caliban's War: The Expanse, Book 2", 0),
    ])

    expect(books).toEqual([
      { position: 1, book: 'Leviathan Wakes' },
      { position: 1.5, book: 'The Butcher of Anderson Station' },
      { position: 2, book: "Caliban's War" },
      { position: 6, book: "Babylon's Ashes" },
    ])
  })
})
