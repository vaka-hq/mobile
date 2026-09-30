import type { HardcoverSeries, HardcoverWork } from '@/sources/hardcover/client'
import { hardcoverSeries, hardcoverWorks } from './catalog'
import { hardcoverWorkId } from './model'
import {
  getFollowedSeries,
  getWork,
  listFollowedSeries,
  saveFollowedSeries,
  setWorkInLibrary,
} from './repository'

/**
 * Adds the series' books the library has not had from it yet and returns every book now known for
 * it. A book the listener removed later is known already, so it is not added back. The details of
 * the books to add are fetched together.
 */
async function addNewBooks(series: HardcoverSeries, known: number[], signal?: AbortSignal) {
  const added = new Set(known)
  const candidates = series.books.filter((book) => !added.has(book.id))

  const works = await Promise.all(
    candidates.map(async (book) => ({ book, work: await getWork(hardcoverWorkId(book.id)) })),
  )

  for (const { book, work } of works) {
    if (work?.inLibrary) {
      added.add(book.id)
    }
  }

  const adding = works.flatMap(({ book, work }) => (work?.inLibrary ? [] : [book.id]))

  const details =
    adding.length > 0 ? await hardcoverWorks(adding, signal) : new Map<number, HardcoverWork>()

  for (const id of adding) {
    // The library shows a book from its Hardcover details, so a book without them waits for the
    // next pass rather than appearing blank.
    const book = details.get(id)

    if (book) {
      await setWorkInLibrary(hardcoverWorkId(id), book, true)
      added.add(id)
    }
  }

  return [...added]
}

/** Puts every book of the series in the library and keeps adding the ones it gains later. */
export async function addSeriesToLibrary(series: HardcoverSeries, signal?: AbortSignal) {
  const known = (await getFollowedSeries(series.id))?.knownBooks ?? []

  await saveFollowedSeries(series.id, series.name, known)
  await saveFollowedSeries(series.id, series.name, await addNewBooks(series, known, signal))
}

/** Adds books that followed series have gained since they were added; returns how many. */
export async function syncFollowedSeries(signal?: AbortSignal) {
  let added = 0

  for (const followed of await listFollowedSeries()) {
    const series = await hardcoverSeries(followed.id, signal).catch(() => null)

    if (series) {
      const known = await addNewBooks(series, followed.knownBooks, signal)

      added += known.length - followed.knownBooks.length
      await saveFollowedSeries(series.id, series.name, known)
    }
  }

  return added
}
