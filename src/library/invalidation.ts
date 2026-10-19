import { queryClient } from '@/lib/query-client'
import type { AbbFeed } from '@/sources/audiobookbay/client'
import type { HardcoverBrowse } from './catalog'

export const queryKeys = {
  library: ['library'] as const,
  book: (id: string) => ['book', id] as const,
  works: ['work'] as const,
  work: (id: string) => ['work', id] as const,
  hardcover: (id: string) => ['hardcover', id] as const,
  torbox: (id: string) => ['torbox', id] as const,
  torboxDownloads: (apiKey: string | null) => ['torbox', 'downloads', apiKey] as const,
  timeline: (id: string) => ['timeline', id] as const,
  bookmarks: (id: string) => ['bookmarks', id] as const,
  feed: (baseUrl: string, feed: AbbFeed) => ['feed', baseUrl, feed] as const,
  hardcoverSearch: (query: string) => ['hardcover-search', query] as const,
  hardcoverWork: (id: number) => ['hardcover-work', id] as const,
  hardcoverSeriesSearch: (query: string) => ['hardcover-series-search', query] as const,
  hardcoverSeries: (id: number) => ['hardcover-series', id] as const,
  followedSeries: ['followed-series'] as const,
  hardcoverGenres: ['hardcover-genres'] as const,
  hardcoverBrowse: (browse: HardcoverBrowse) => ['hardcover-browse', browse] as const,
  recordings: (baseUrl: string, workId: number) => ['recordings', baseUrl, workId] as const,
  torboxCached: (hashes: string[]) => ['torbox-cached', ...hashes] as const,
  torboxSwarm: (hash: string) => ['torbox-swarm', hash.toLowerCase()] as const,
  ebookSearch: (query: string, annas: boolean) => ['ebook-search', query, annas] as const,
  ebookMarks: (md5: string) => ['ebook-marks', md5] as const,
}

/** What changed: the library or a book's state, or only where listening stands. */
type LibraryChange = 'library' | 'listening'

const changeListeners = new Set<(change: LibraryChange) => void>()

/** Hears every change to the library and to listening, such as to keep Hardcover in step. */
export function onLibraryChange(listener: (change: LibraryChange) => void) {
  changeListeners.add(listener)

  return () => {
    changeListeners.delete(listener)
  }
}

function notify(change: LibraryChange) {
  for (const listener of changeListeners) {
    listener(change)
  }
}

/**
 * Shows the library afresh without telling the listeners of a change, for library sync's own
 * changes, which must not start another run.
 */
export function refreshLibrary() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.library })
  void queryClient.invalidateQueries({ queryKey: queryKeys.works })
  void queryClient.invalidateQueries({ queryKey: queryKeys.followedSeries })
}

export function invalidateLibrary() {
  refreshLibrary()
  notify('library')
}

/** Listening has moved on and its place was saved, without anything else changing. */
export function noteListening() {
  notify('listening')
}

export function invalidateBook(id: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.book(id) })
  invalidateLibrary()
}
