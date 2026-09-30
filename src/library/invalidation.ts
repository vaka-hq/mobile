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

export function invalidateLibrary() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.library })
  void queryClient.invalidateQueries({ queryKey: queryKeys.works })
  void queryClient.invalidateQueries({ queryKey: queryKeys.followedSeries })
}

export function invalidateBook(id: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.book(id) })
  invalidateLibrary()
}
