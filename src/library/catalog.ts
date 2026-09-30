import { type AbbFeed, fetchFeed, feedUrl } from '@/sources/audiobookbay/client'
import { abbListingPageSchema } from '@/sources/audiobookbay/parse'
import {
  bookForRecording,
  fetchGenreBooks,
  fetchGenres,
  fetchHardcoverSeries,
  fetchHardcoverWork,
  fetchHardcoverWorks,
  HardcoverError,
  type HardcoverWork,
  fetchTrending,
  hardcoverBrowsePageSchema,
  hardcoverGenreSchema,
  hardcoverHitSchema,
  hardcoverSeriesPageSchema,
  hardcoverSeriesSchema,
  hardcoverWorkSchema,
  type RecordingHints,
  searchBooks,
  searchBooksPage,
  searchSeriesPage,
} from '@/sources/hardcover/client'
import { abbReader } from './abb-reader'
import {
  getCachedResponse,
  getStaleCachedResponse,
  pruneCachedResponses,
  saveCachedResponse,
} from './repository'
import { createRequestCache } from './request-cache'

const cachedRequest = createRequestCache({
  get: getCachedResponse,
  getStale: getStaleCachedResponse,
  set: saveCachedResponse,
  prune: pruneCachedResponses,
})

const minute = 60 * 1000

const hour = 60 * minute

/**
 * How long each kind of answer is reused. The latest uploads change through the day; searches and
 * genres slowly; Hardcover's catalogue barely. Posts themselves are kept with the book for a day.
 */
export const cacheLifetimes = {
  latest: 15 * minute,
  listing: 2 * hour,
  hardcoverSearch: 24 * hour,
  // Trending moves through the day; genre rankings and the genre list change slowly.
  trending: 3 * hour,
  genreBooks: 24 * hour,
  genres: 7 * 24 * hour,
  hardcoverBook: 24 * hour,
}

/** One page of an AudioBookBay listing, keyed by its address so mirrors cache separately. */
export function feedPage(baseUrl: string, feed: AbbFeed, page: number, signal?: AbortSignal) {
  return cachedRequest(
    `abb:${feedUrl(baseUrl, feed, page)}`,
    feed.kind === 'latest' ? cacheLifetimes.latest : cacheLifetimes.listing,
    abbListingPageSchema,
    () => fetchFeed(baseUrl, feed, page, signal, abbReader()),
  )
}

function searchKey(text: string) {
  return text.trim().toLowerCase().replace(/\s+/gu, ' ')
}

export function hardcoverSearch(text: string, signal?: AbortSignal) {
  return cachedRequest(
    `hardcover:search:v2:${searchKey(text)}`,
    cacheLifetimes.hardcoverSearch,
    hardcoverHitSchema.array(),
    () => searchBooks(text.trim(), signal),
  )
}

/** One page of books found by a search in Browse, counted from 1. */
export function hardcoverSearchPage(text: string, page: number, signal?: AbortSignal) {
  return cachedRequest(
    `hardcover:search-page:${searchKey(text)}:${page}`,
    cacheLifetimes.hardcoverSearch,
    hardcoverBrowsePageSchema,
    () => searchBooksPage(text.trim(), page, signal),
  )
}

export function hardcoverGenres(signal?: AbortSignal) {
  return cachedRequest(
    'hardcover:genres',
    cacheLifetimes.genres,
    hardcoverGenreSchema.array(),
    () => fetchGenres(signal),
  )
}

/** What Hardcover offers to browse: this month's trending books or a genre's best known. */
export type HardcoverBrowse = { kind: 'trending' } | { kind: 'genre'; tagId: number }

export function hardcoverBrowsePage(browse: HardcoverBrowse, page: number, signal?: AbortSignal) {
  return browse.kind === 'trending'
    ? cachedRequest(
        `hardcover:trending:${page}`,
        cacheLifetimes.trending,
        hardcoverBrowsePageSchema,
        () => fetchTrending(page, signal),
      )
    : cachedRequest(
        `hardcover:genre:${browse.tagId}:${page}`,
        cacheLifetimes.genreBooks,
        hardcoverBrowsePageSchema,
        () => fetchGenreBooks(browse.tagId, page, signal),
      )
}

/** One page of series found by a search in Browse, counted from 1. */
export function hardcoverSeriesSearchPage(text: string, page: number, signal?: AbortSignal) {
  return cachedRequest(
    `hardcover:series-search:v2:${searchKey(text)}:${page}`,
    cacheLifetimes.hardcoverSearch,
    hardcoverSeriesPageSchema,
    () => searchSeriesPage(text.trim(), page, signal),
  )
}

/** A series' books in reading order; new entries are rare, so a day's copy is reused. */
export function hardcoverSeries(id: number, signal?: AbortSignal) {
  return cachedRequest(
    `hardcover:series:${id}`,
    cacheLifetimes.hardcoverBook,
    hardcoverSeriesSchema,
    () => fetchHardcoverSeries(id, signal),
  )
}

function hardcoverWorkKey(id: number) {
  return `hardcover:book:v6:${id}`
}

/** A Hardcover book with its audiobook editions; `fresh` skips the cache for a manual refresh. */
export function hardcoverWork(id: number, signal?: AbortSignal, options: { fresh?: boolean } = {}) {
  return cachedRequest(
    hardcoverWorkKey(id),
    cacheLifetimes.hardcoverBook,
    hardcoverWorkSchema,
    () => fetchHardcoverWork(id, signal),
    options,
  )
}

/** How many books one request asks Hardcover for, each with up to 40 editions. */
const worksPerRequest = 10

/**
 * Many Hardcover books at once, for adding a series: the ones cached are read from the cache and
 * the rest fetched together, a few requests side by side, instead of one request per book. A
 * book Hardcover does not have is left out.
 */
export async function hardcoverWorks(ids: number[], signal?: AbortSignal) {
  const found = new Map<number, HardcoverWork>()

  await Promise.all(
    ids.map(async (id) => {
      const stored = await getCachedResponse(hardcoverWorkKey(id))
      const parsed = stored === null ? null : readCachedWork(stored)

      if (parsed) {
        found.set(id, parsed)
      }
    }),
  )

  const missing = ids.filter((id) => !found.has(id))

  const requests = Array.from({ length: Math.ceil(missing.length / worksPerRequest) }, (_, index) =>
    missing.slice(index * worksPerRequest, (index + 1) * worksPerRequest),
  )

  await Promise.all(
    requests.map(async (batch) => {
      for (const work of await fetchWorks(batch, signal)) {
        found.set(work.id, work)
        // Stored as a single book's answer, so the book's page opens from it.
        await cachedRequest(
          hardcoverWorkKey(work.id),
          cacheLifetimes.hardcoverBook,
          hardcoverWorkSchema,
          () => Promise.resolve(work),
          { fresh: true },
        )
      }
    }),
  )

  return found
}

function readCachedWork(text: string) {
  try {
    const parsed = hardcoverWorkSchema.safeParse(JSON.parse(text))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Books fetched together; should Hardcover refuse the query itself, one by one instead, side by
 * side, leaving out any that fail.
 */
async function fetchWorks(ids: number[], signal?: AbortSignal) {
  try {
    return await fetchHardcoverWorks(ids, signal)
  } catch (error) {
    if (!(error instanceof HardcoverError) || error.status !== null) {
      throw error
    }

    const works = await Promise.all(
      ids.map((id) => fetchHardcoverWork(id, signal).catch(() => null)),
    )

    return works.filter((work) => work !== null)
  }
}

/** The book as one posted recording presents it, from the cached Hardcover book. */
export async function hardcoverBook(
  id: number,
  hints: RecordingHints,
  signal?: AbortSignal,
  options: { fresh?: boolean } = {},
) {
  return bookForRecording(await hardcoverWork(id, signal, options), hints)
}
