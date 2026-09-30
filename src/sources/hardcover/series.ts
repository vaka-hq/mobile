/** One book's place in a series as Hardcover lists it, before duplicates are removed. */
export type SeriesEntry<T> = {
  position: number | null
  compilation: boolean
  /** Set on duplicate and translated records that point at the canonical book. */
  canonicalId: number | null
  usersCount: number
  book: T
}

/**
 * The series as a reader sees it: one book per position (the most read), in order, without
 * omnibus editions, translations or duplicate records.
 */
export function seriesBooks<T>(entries: SeriesEntry<T>[]) {
  const byPosition = new Map<number, SeriesEntry<T>>()

  for (const entry of entries) {
    if (entry.position === null || entry.compilation || entry.canonicalId !== null) {
      continue
    }

    const current = byPosition.get(entry.position)

    if (!current || entry.usersCount > current.usersCount) {
      byPosition.set(entry.position, entry)
    }
  }

  return [...byPosition.entries()]
    .sort(([left], [right]) => left - right)
    .map(([position, entry]) => ({ position, book: entry.book }))
}
