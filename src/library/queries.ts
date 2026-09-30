import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import { concurrencyLimit } from '@/lib/limit'
import { queryClient } from '@/lib/query-client'
import { close, closeWork, getState, open, refreshBook, switchStream } from '@/player/controller'
import { useAnnasKey } from '@/settings/annas-key'
import { usePreferences } from '@/settings/preferences'
import { torBoxKey, useTorBoxKey } from '@/settings/torbox-key'
import type { AbbFeed } from '@/sources/audiobookbay/client'
import type { AbbBook } from '@/sources/audiobookbay/parse'
import type { HardcoverSeries, HardcoverWork } from '@/sources/hardcover/client'
import { AbbSilentError } from './abb-reader'
import {
  cancelDownload,
  chooseHardcover,
  linkRecording,
  ensureStreamable,
  loadBook,
  matchHardcover,
  prepareTimeline,
  torBoxDownloads,
  type TorBoxStatus,
  torBoxStatus,
} from './books'
import {
  cacheLifetimes,
  feedPage,
  type HardcoverBrowse,
  hardcoverBrowsePage,
  hardcoverGenres,
  hardcoverSearch,
  hardcoverSearchPage,
  hardcoverSeries,
  hardcoverSeriesSearchPage,
  hardcoverWork,
} from './catalog'
import { splitTitle } from './display'
import { rankEbooks } from './ebook-rank'
import {
  addMark,
  chooseEbook,
  deleteEbookDownload,
  deleteMark,
  downloadEbook,
  type Ebook,
  ebookResultOf,
  type EbookMark,
  type EbookResult,
  firstEbookPage,
  forgetReadingOf,
  listEbooks,
  listMarks,
  searchEbooks,
  searchEbooksPage,
  updateMark,
  useEbooks,
} from './ebooks'
import { NotStreamableError } from './errors'
import { invalidateBook, invalidateLibrary, queryKeys } from './invalidation'
import { type BookRecord, hardcoverWorkId, workIdOf } from './model'
import { offlineBook, removeOffline, removeOfflineForWork, useOfflineBooks } from './offline'
import { defaultStreamId, findRecordingListings, groupByNarrator } from './recordings'
import {
  addBookmark,
  chooseStream,
  deleteBookmark,
  deleteFollowedSeries,
  saveBookmarkNote,
  getBook,
  getPlayback,
  lastHeardStream,
  listBookmarks,
  listFollowedSeries,
  listLibrary,
  markWorkFinished,
  markWorkNotStarted,
  removeWorkFromLibrary,
  forgetStreamProgress,
  getWork,
  keptStreamsOf,
  libraryWorksOf,
  setWorkInLibrary,
  streamsOfWork,
  worksOfBook,
} from './repository'
import { addSeriesToLibrary, syncFollowedSeries } from './series-library'
import { bookDuration, bookPosition } from './timeline'
import { type Swarm, torBoxCachedHashes, torrentSwarmOf } from './torbox-cache'

/** Local reads are cheap and only change through this app, so writes invalidate them. */
const local = { staleTime: Number.POSITIVE_INFINITY, retry: false } as const

/**
 * When a book was last listened to, on whichever recording: the time its place was last saved,
 * or null. Refreshed with the library, which every save while playing refreshes.
 */
export function useLastHeardAt(workId: string) {
  return useQuery({
    queryKey: [...queryKeys.work(workId), 'heard'],
    queryFn: async () => {
      const bookId = await lastHeardStream(workId)
      const playback = bookId ? await getPlayback(bookId) : null

      return playback?.updatedAt ?? null
    },
    ...local,
  })
}

/**
 * How far a book was listened to, on the recording listened to last: from 0 to 1, and the time
 * left, when the recording's length is known; null when it was not listened to.
 */
export function useListeningProgress(workId: string) {
  return useQuery({
    queryKey: [...queryKeys.work(workId), 'listening'],
    queryFn: async () => {
      const bookId = await lastHeardStream(workId)
      const book = bookId ? await getBook(bookId) : null
      const playback = book ? await getPlayback(book.id) : null
      const total = book ? bookDuration(book.durations) : null

      if (!book || !playback) {
        return null
      }

      if (playback.finished) {
        return { progress: 1, left: 0 }
      }

      if (total === null || !book.durations) {
        return { progress: null, left: null }
      }

      const elapsed = bookPosition(book.durations, playback.track, playback.position)

      return { progress: elapsed / total, left: Math.max(0, total - elapsed) }
    },
    ...local,
  })
}

export function useLibrary() {
  return useQuery({ queryKey: queryKeys.library, queryFn: listLibrary, ...local })
}

export function useFeed(feed: AbbFeed, enabled = true) {
  const { abbBaseUrl } = usePreferences()

  return useInfiniteQuery({
    queryKey: queryKeys.feed(abbBaseUrl, feed),
    queryFn: ({ pageParam, signal }) => feedPage(abbBaseUrl, feed, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last, _pages, page) => (last.hasNextPage ? page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: feed.kind === 'latest' ? cacheLifetimes.latest : cacheLifetimes.listing,
    // Asking a site that has gone silent again only adds to what it blocks the phone for.
    retry: (count, error) => !(error instanceof AbbSilentError) && count < 1,
    enabled: enabled && (feed.kind !== 'search' || feed.query.trim().length >= 2),
  })
}

/** The stored book, downloaded from AudioBookBay on first visit and refreshed daily. */
export function useBook(id: string) {
  return useQuery({
    queryKey: queryKeys.book(id),
    queryFn: ({ signal }) => loadBook(id, signal),
    ...local,
  })
}

export function useHardcoverMatch(book: BookRecord | undefined, connected: boolean) {
  return useQuery({
    queryKey: queryKeys.hardcover(book?.id ?? ''),
    queryFn: async ({ signal }) => {
      if (!book) {
        throw new Error('No book to match')
      }

      const matched = await matchHardcover(book, signal)

      queryClient.setQueryData(queryKeys.book(matched.id), matched)

      return matched.hardcover
    },
    enabled: Boolean(book) && connected,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** A stream's TorBox status, polled while it downloads; shared by every screen showing it. */
function torBoxStatusQuery(book: BookRecord | undefined, apiKey: string | null) {
  return {
    queryKey: [...queryKeys.torbox(book?.id ?? ''), apiKey],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      if (!book) {
        throw new Error('No book to check')
      }

      const status = await torBoxStatus(book, signal)

      if (status.kind === 'ready') {
        invalidateBook(book.id)
        // Finished in the listener's TorBox, it is cached there now; source lists follow.
        void queryClient.invalidateQueries({ queryKey: ['torbox-cached'] })
      }

      return status
    },
    enabled: Boolean(book) && Boolean(apiKey),
    // A download is never shown from memory: coming back to it, it is asked for again at once.
    staleTime: (query: { state: { data?: TorBoxStatus } }) =>
      query.state.data?.kind === 'downloading' ? 0 : 30 * 1000,
    // Well-seeded audiobooks often finish within a minute, so a download is followed closely at
    // first, then less often, and seldom while TorBox cannot be reached or the download stalls.
    refetchInterval: (query: {
      state: { data?: TorBoxStatus; dataUpdateCount: number; fetchFailureCount: number }
    }) => {
      const data = query.state.data

      if (data?.kind !== 'downloading') {
        return false
      }

      if (query.state.fetchFailureCount > 0 || data.stalled) {
        return 30 * 1000
      }

      return query.state.dataUpdateCount < 30 ? 3000 : 15 * 1000
    },
  }
}

export function useTorBoxStatus(book: BookRecord | undefined) {
  return useQuery(torBoxStatusQuery(book, useTorBoxKey()))
}

/**
 * The TorBox status of each stream this app has added to TorBox that is not playable yet, by
 * book. They are looked up by torrent, since TorBox's full list is slow to show new torrents.
 */
export function useAddedDownloads(books: BookRecord[]) {
  const apiKey = useTorBoxKey()
  const added = books.filter((book) => book.torrentId !== null && !book.tracks)
  const statuses = useQueries({ queries: added.map((book) => torBoxStatusQuery(book, apiKey)) })

  return new Map(added.map((book, index) => [book.id, statuses[index]?.data ?? null]))
}

export function useTimeline(book: BookRecord | undefined) {
  return useQuery({
    queryKey: queryKeys.timeline(book?.id ?? ''),
    queryFn: async () => {
      if (!book) {
        throw new Error('No book to prepare')
      }

      const prepared = await prepareTimeline(book)

      queryClient.setQueryData(queryKeys.book(prepared.id), prepared)
      await refreshBook(prepared.id)

      return prepared
    },
    enabled: Boolean(book?.tracks) && book?.torrentId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

export function useWork(id: string) {
  return useQuery({ queryKey: queryKeys.work(id), queryFn: () => getWork(id), ...local })
}

/**
 * Adds a book (never a single stream) to the library, or removes it: that stops it playing and
 * forgets its listening and reading progress, its bookmarks and what was kept on the phone.
 */
export function useSetWorkInLibrary(id: string, hardcover: HardcoverWork | null) {
  return useMutation({
    mutationFn: (inLibrary: boolean) =>
      inLibrary ? setWorkInLibrary(id, hardcover, true) : removeFromLibrary(id),
    onSettled: () => invalidateLibrary(),
  })
}

/**
 * Takes a book out of the library, with its progress, bookmarks and what the phone kept of it,
 * its e-books' files, places and notes too, under every work it is kept as. The player lets go of it first if it plays any of its streams,
 * so it cannot save the place again, or put the book back, once it is gone.
 */
async function removeFromLibrary(id: string) {
  for (const work of await worksOfBook(id)) {
    const streams = await streamsOfWork(work)
    const playing = getState().book

    if (playing && (workIdOf(playing) === work || streams.includes(playing.id))) {
      // Closing saves the player's position, so it goes before the removal that forgets it.
      await close()
    }

    await removeWorkFromLibrary(work)
    await forgetReadingOf(work)

    // Its e-books go with it: each file on the phone, its place, highlights, notes and bookmarks.
    for (const ebook of listEbooks().filter((item) => item.workId === work)) {
      await deleteEbookDownload(ebook.md5).catch(() => undefined)
      void queryClient.invalidateQueries({ queryKey: queryKeys.ebookMarks(ebook.md5) })
    }

    // What the phone kept goes too, but the book is out of the library even if that fails.
    await removeOfflineForWork(work).catch(() => undefined)
  }
}

/**
 * Deletes an audiobook's download with what was saved while listening to it, its place and
 * bookmarks; the player lets go of it first if it has it open.
 */
export async function deleteAudiobookDownload(bookId: string) {
  if (getState().book?.id === bookId) {
    await close()
  }

  await removeOffline(bookId)
  await forgetStreamProgress(bookId)
  invalidateLibrary()
  void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(bookId) })
}

/** Deletes an e-book's download with its place, highlights, notes and bookmarks. */
export async function deleteEbookFile(md5: string) {
  await deleteEbookDownload(md5)
  invalidateLibrary()
  void queryClient.invalidateQueries({ queryKey: queryKeys.ebookMarks(md5) })
}

/** An audiobook downloaded to the phone, with whether the listener finished it. */
export type DownloadedAudiobook = { id: string; book: BookRecord | null; finished: boolean }

/**
 * The audiobooks downloaded to the phone, or on their way, each with whether its book was
 * finished; how far a download has got is read live from the phone.
 */
export function useDownloadedAudiobooks() {
  const offline = useOfflineBooks()
  const ids = [...offline.keys()]

  return useQuery({
    queryKey: [...queryKeys.works, 'downloaded', ids],
    queryFn: () =>
      Promise.all(
        ids.map(async (id): Promise<DownloadedAudiobook> => {
          const book = await getBook(id)
          const playback = await getPlayback(id)
          const work = book ? await getWork(workIdOf(book)) : null

          return { id, book, finished: Boolean(playback?.finished || work?.finishedAt) }
        }),
      ),
    ...local,
    placeholderData: keepPreviousData,
  })
}

/** The books the given works are, to tell which were finished. */
export function useWorksOf(ids: string[]) {
  return useQuery({
    queryKey: [...queryKeys.works, 'of', ids],
    queryFn: async () =>
      new Map(await Promise.all(ids.map(async (id) => [id, await getWork(id)] as const))),
    ...local,
    placeholderData: keepPreviousData,
  })
}

/**
 * Marks a book finished or not started. The player lets go of it first if it plays any of its
 * recordings, even one matched to the book after it was opened, so it cannot save the place back.
 */
export function useMarkWork(id: string, hardcover: HardcoverWork | null) {
  return useMutation({
    mutationFn: async (mark: 'finished' | 'notStarted') => {
      const playing = getState().book

      // Closing saves the player's position, so it goes before the mark that overrides it.
      if (playing && (workIdOf(playing) === id || (await streamsOfWork(id)).includes(playing.id))) {
        await close()
      } else {
        await closeWork(id)
      }

      await (mark === 'finished' ? markWorkFinished(id, hardcover) : markWorkNotStarted(id))
      // Either way the progress starts over, reading as well as listening.
      await forgetReadingOf(id)

      return streamsOfWork(id)
    },
    onSettled: (streams) => {
      invalidateLibrary()

      // Each recording's page reads when it was last played from its own cached copy.
      for (const streamId of streams ?? []) {
        invalidateBook(streamId)
      }
    },
  })
}

/**
 * Picks the stream a Hardcover book plays and remembers it. The stream takes that book's details
 * for its recording, so the player and notification show the right cover and narrator.
 */
export function useChooseStream(id: string, hardcover: HardcoverWork | null) {
  return useMutation({
    mutationFn: async (streamId: string) => {
      if (hardcover) {
        await linkRecording(streamId, hardcover)
      }

      await chooseStream(id, hardcover, streamId)

      return streamId
    },
    onSettled: (_data, _error, streamId) => {
      invalidateBook(streamId)
      invalidateLibrary()
      void queryClient.invalidateQueries({ queryKey: queryKeys.hardcover(streamId) })
    },
  })
}

export function useHardcoverSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.hardcoverSearch(query.trim()),
    queryFn: ({ signal }) => hardcoverSearch(query, signal),
    enabled: enabled && query.trim().length >= 2,
    placeholderData: keepPreviousData,
  })
}

/** Books found on Hardcover, page by page as Browse's list scrolls. */
export function useHardcoverSearchPages(query: string, enabled: boolean) {
  const trimmed = query.trim()

  return useInfiniteQuery({
    queryKey: [...queryKeys.hardcoverSearch(trimmed), 'pages'],
    queryFn: ({ pageParam, signal }) => hardcoverSearchPage(trimmed, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last, _pages, page) => (last.hasNextPage ? page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: cacheLifetimes.hardcoverSearch,
    enabled: enabled && trimmed.length >= 2,
  })
}

export function useChooseHardcover(bookId: string) {
  return useMutation({
    mutationFn: (hardcoverId: number | null) => chooseHardcover(bookId, hardcoverId),
    onSettled: () => {
      invalidateBook(bookId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.works })
      void queryClient.invalidateQueries({ queryKey: queryKeys.hardcover(bookId) })
    },
  })
}

export function useBookmarks(bookId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bookmarks(bookId ?? ''),
    queryFn: () => listBookmarks(bookId ?? ''),
    enabled: Boolean(bookId),
    ...local,
  })
}

export function useAddBookmark(bookId: string) {
  return useMutation({
    mutationFn: ({ track, position }: { track: number; position: number }) =>
      addBookmark(bookId, track, position, null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(bookId) }),
  })
}

/** Writes a bookmark's note; an empty note clears it. */
export function useBookmarkNote(bookId: string) {
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      saveBookmarkNote(id, note.trim() === '' ? null : note.trim()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(bookId) }),
  })
}

export function useDeleteBookmark(bookId: string) {
  return useMutation({
    mutationFn: deleteBookmark,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks(bookId) }),
  })
}

/**
 * Starts listening, adding the book to TorBox first when needed. Resolves `downloading` while it
 * downloads, and `cancelled` when the listener was asked where to start and closed the question.
 */
export function useStartListening(bookId: string) {
  return useMutation({
    mutationFn: async (): Promise<'playing' | 'downloading' | 'cancelled'> => {
      // A book kept on the phone plays without asking TorBox, so it works offline too.
      if (offlineBook(bookId)?.status !== 'done') {
        const status = await ensureStreamable(bookId)

        if (status.kind === 'noAudio') {
          throw new NotStreamableError()
        }

        if (status.kind !== 'ready') {
          return 'downloading'
        }

        invalidateBook(bookId)
      }

      return (await open(bookId, true)) ? 'playing' : 'cancelled'
    },
    onSettled: () => {
      // Adding stores the torrent on the book, which other screens read.
      invalidateBook(bookId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.torbox(bookId) })
    },
  })
}

/**
 * Moves the open book to another of its streams, adding it to TorBox first when needed. It
 * outlives the screen that starts it, so its outcome goes to `onSettled`: false while the new
 * stream downloads, when the current one keeps playing.
 */
export function useSwitchStream(onSettled: (switched: boolean, error: Error | null) => void) {
  return useMutation({
    mutationFn: async (streamId: string) => {
      const status = await ensureStreamable(streamId)

      if (status.kind !== 'ready') {
        return false
      }

      // Measured first, so the new stream can start where the listener is in the book.
      const book = await getBook(streamId)
      const prepared = book ? await prepareTimeline(book).catch(() => null) : null

      if (prepared) {
        queryClient.setQueryData(queryKeys.timeline(prepared.id), prepared)
        queryClient.setQueryData(queryKeys.book(prepared.id), prepared)
      }

      invalidateBook(streamId)
      await switchStream(streamId)

      return true
    },
    onSettled: (switched, error, streamId) => {
      invalidateBook(streamId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.torbox(streamId) })
      onSettled(switched ?? false, error)
    },
  })
}

/**
 * The listener's TorBox downloads by info hash, polled while any of `hashes` is still downloading
 * so their progress moves.
 */
export function useTorBoxDownloads(hashes: string[]) {
  const apiKey = useTorBoxKey()
  const watched = new Set(hashes.map((hash) => hash.toLowerCase()))

  return useQuery({
    queryKey: queryKeys.torboxDownloads(apiKey),
    queryFn: ({ signal }) => torBoxDownloads(signal),
    enabled: Boolean(apiKey) && hashes.length > 0,
    staleTime: 0,
    refetchInterval: (query) => {
      const downloads = query.state.data

      if (query.state.fetchFailureCount > 0) {
        return 30 * 1000
      }

      return downloads &&
        [...watched].some((hash) => {
          const download = downloads.get(hash)

          return download !== undefined && !download.finished
        })
        ? 5000
        : false
    },
  })
}

/** Tracker lookups wait several seconds each, so only a few run at once. */
const swarmLimit = concurrencyLimit(3)

function swarmQuery(post: AbbBook | null, apiKey: string | null) {
  return {
    queryKey: [...queryKeys.torboxSwarm(post?.infoHash ?? ''), apiKey],
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<Swarm | null> =>
      post ? swarmLimit(() => torrentSwarmOf(apiKey ?? '', post, signal)) : Promise.resolve(null),
    enabled: Boolean(apiKey) && post !== null,
    staleTime: 30 * 60 * 1000,
    retry: false,
  }
}

/**
 * Who is sharing each of `posts`, by lowercased info hash: `swarm` is undefined until looked up,
 * null when the trackers did not say, and an upload without seeders is most likely dead. Nothing
 * is looked up until `check`, and an answer found before is kept; leaving the screen stops the
 * lookups still running.
 */
export function useTorrentSwarms(posts: AbbBook[], check: boolean) {
  const apiKey = useTorBoxKey()

  const swarms = useQueries({
    queries: posts.map((post) => {
      const query = swarmQuery(post, apiKey)

      return { ...query, enabled: query.enabled && check }
    }),
  })

  return new Map(
    posts.map((post, index) => {
      const swarm = swarms[index]

      return [
        post.infoHash.toLowerCase(),
        { swarm: swarm?.data, checking: swarm?.fetchStatus === 'fetching' },
      ] as const
    }),
  )
}

/** Looks up who is sharing one upload, as a tap on it does; aborting stops the lookup. */
export async function fetchSwarm(post: AbbBook, signal: AbortSignal) {
  const query = swarmQuery(post, torBoxKey.get())

  signal.addEventListener('abort', () => {
    void queryClient.cancelQueries({ queryKey: query.queryKey })
  })

  return queryClient.fetchQuery(query)
}

/** Who is sharing one upload, such as the one whose details are open. */
export function useTorrentSwarm(post: AbbBook | null) {
  return useQuery(swarmQuery(post, useTorBoxKey()))
}

/** Stops TorBox downloading a stream and removes it there. */
export function useCancelDownload() {
  return useMutation({
    mutationFn: cancelDownload,
    onSettled: (_data, _error, bookId) => {
      invalidateBook(bookId)
      void queryClient.invalidateQueries({ queryKey: ['torbox'] })
    },
  })
}

export function useHardcoverWork(id: number) {
  return useQuery({
    queryKey: queryKeys.hardcoverWork(id),
    queryFn: ({ signal }) => hardcoverWork(id, signal),
    enabled: Number.isInteger(id) && id > 0,
    staleTime: 60 * 60 * 1000,
  })
}

/** AudioBookBay throttles bursts, so posts found for a book open a few at a time. */
const postLimit = concurrencyLimit(3)

/**
 * Every upload of a Hardcover book on AudioBookBay, opened one by one to learn its narrator.
 * Opened posts share the book cache, so tapping one opens at once. TorBox's cache is checked for
 * all of them in one request once they have loaded.
 */
export function useRecordings(work: HardcoverWork | undefined, include: (string | null)[] = []) {
  const { abbBaseUrl } = usePreferences()
  const apiKey = useTorBoxKey()

  const listings = useQuery({
    queryKey: queryKeys.recordings(abbBaseUrl, work?.id ?? 0),
    queryFn: ({ signal }) => {
      if (!work) {
        throw new Error('No book to look for')
      }

      return findRecordingListings(work, (feed, page) => feedPage(abbBaseUrl, feed, page, signal))
    },
    enabled: Boolean(work),
    staleTime: 10 * 60 * 1000,
  })

  // The stream opened from a post or remembered for the book is shown even when search misses it.
  const ids = [
    ...new Set([
      ...include.filter((id): id is string => Boolean(id)),
      ...(listings.data ?? []).map((listing) => listing.id),
    ]),
  ]

  const posts = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.book(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => postLimit(() => loadBook(id, signal)),
      ...local,
    })),
  })

  const loaded = posts.flatMap((post) => (post.data ? [post.data] : []))
  const pending = posts.filter((post) => post.isPending).length
  const failed = posts.filter((post) => post.error && !post.data)
  const hashes = loaded.map((book) => book.abb.infoHash.toLowerCase()).sort()

  const cached = useQuery({
    queryKey: [...queryKeys.torboxCached(hashes), apiKey],
    queryFn: ({ signal }) => torBoxCachedHashes(apiKey ?? '', hashes, signal),
    enabled: Boolean(apiKey) && pending === 0 && hashes.length > 0,
    // Answers persist per torrent (see torbox-cache), so a revisit reads them without asking TorBox.
    staleTime: 10 * 60 * 1000,
  })

  return {
    listings,
    books: loaded,
    pending,
    failed: failed.length,
    retryFailed: () => {
      for (const post of failed) {
        void post.refetch()
      }
    },
    cached: cached.data ?? null,
  }
}

/** Series found on Hardcover, page by page as Browse's list scrolls. */
export function useHardcoverSeriesSearch(query: string, enabled: boolean) {
  const trimmed = query.trim()

  return useInfiniteQuery({
    queryKey: queryKeys.hardcoverSeriesSearch(trimmed),
    queryFn: ({ pageParam, signal }) => hardcoverSeriesSearchPage(trimmed, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last, _pages, page) => (last.hasNextPage ? page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: cacheLifetimes.hardcoverSearch,
    enabled: enabled && trimmed.length >= 2,
  })
}

export function useHardcoverSeries(id: number) {
  return useQuery({
    queryKey: queryKeys.hardcoverSeries(id),
    queryFn: ({ signal }) => hardcoverSeries(id, signal),
    enabled: Number.isInteger(id) && id > 0,
    staleTime: 60 * 60 * 1000,
  })
}

/** The series wholly in the library. */
export function useFollowedSeries() {
  return useQuery({ queryKey: queryKeys.followedSeries, queryFn: listFollowedSeries, ...local })
}

/** Adds a whole series to the library, or takes it out again. */
export function useSeriesInLibrary(series: HardcoverSeries | undefined) {
  return useMutation({
    mutationFn: async (inLibrary: boolean) => {
      if (!series) {
        return
      }

      if (inLibrary) {
        await addSeriesToLibrary(series)

        return
      }

      // Every book goes, with its progress, as a single book removed does.
      await deleteFollowedSeries(series.id)

      const works = await libraryWorksOf(series.books.map((book) => book.id))

      for (const id of works) {
        await removeFromLibrary(id)
      }
    },
    onSettled: async () => {
      invalidateLibrary()
      // Waited for, so the sheet's button keeps what was asked until the list says the same.
      await queryClient.refetchQueries({ queryKey: queryKeys.followedSeries })
    },
  })
}

/** Adds books that followed series have gained, a few times a day while the library is open. */
export function useSyncFollowedSeries() {
  return useQuery({
    queryKey: ['followed-series-sync'],
    queryFn: async ({ signal }) => {
      const added = await syncFollowedSeries(signal)

      if (added > 0) {
        invalidateLibrary()
      }

      return added
    },
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  })
}

export function useHardcoverGenres(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.hardcoverGenres,
    queryFn: ({ signal }) => hardcoverGenres(signal),
    enabled,
    staleTime: cacheLifetimes.genres,
  })
}

/** Hardcover's trending books or a genre's, page by page as the list scrolls. */
export function useHardcoverBrowse(browse: HardcoverBrowse, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.hardcoverBrowse(browse),
    queryFn: ({ pageParam, signal }) => hardcoverBrowsePage(browse, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, page) => (last.hasNextPage ? page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: browse.kind === 'trending' ? cacheLifetimes.trending : cacheLifetimes.genreBooks,
    enabled,
  })
}

/**
 * A Hardcover book with its streams and the one Listen plays: the `preferred` stream (opened from
 * a post), else the one remembered for the book, else a good default once every stream and
 * TorBox's cache are known, so the choice does not jump while streams load.
 */
export function useWorkStreams(hardcoverId: number, preferred: string | null) {
  const apiKey = useTorBoxKey()
  const workId = hardcoverWorkId(hardcoverId)
  const work = useHardcoverWork(hardcoverId)
  const record = useWork(workId)

  // Recordings kept on the phone are always shown, even when a search misses them, and one
  // stands in for a choice never made, so Listen plays the copy on the phone.
  const kept =
    useQuery({
      queryKey: [...queryKeys.work(workId), 'kept'],
      queryFn: () => keptStreamsOf(hardcoverId),
      ...local,
    }).data ?? []

  const recordings = useRecordings(work.data, [preferred, record.data?.streamId ?? null, ...kept])
  const choose = useChooseStream(workId, work.data ?? null)
  const { preferredLanguage } = usePreferences()
  const settled = !recordings.listings.isPending && recordings.pending === 0
  const cacheKnown = !apiKey || recordings.cached !== null || recordings.books.length === 0

  const groups = work.data
    ? groupByNarrator(
        work.data,
        recordings.books.map((book) => book.abb),
        preferredLanguage,
      )
    : []

  const selectedId =
    preferred ??
    record.data?.streamId ??
    kept[0] ??
    (settled && cacheKnown ? defaultStreamId(groups, recordings.cached, preferredLanguage) : null)

  const stream = recordings.books.find((book) => book.id === selectedId) ?? null

  /** Where finding a stream has got to, for one clear status while there is none. */
  const finding = !settled
    ? ('searching' as const)
    : recordings.books.length === 0
      ? ('none' as const)
      : !cacheKnown
        ? ('checking' as const)
        : null

  return { workId, work, record, recordings, groups, settled, finding, selectedId, stream, choose }
}

/** EPUBs of a book on Anna's Archive and Library Genesis. */
export function useEbookSearch(query: string, enabled = true) {
  // A new member key searches Anna's Archive too, so it searches again.
  const annas = Boolean(useAnnasKey())
  const trimmed = query.trim()

  return useQuery({
    queryKey: queryKeys.ebookSearch(trimmed, annas),
    queryFn: ({ signal }) => searchEbooks(trimmed, signal),
    enabled: enabled && trimmed.length >= 2,
    staleTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

/** EPUBs found by a search in Browse, page by page as the list scrolls. */
export function useEbookSearchPages(query: string) {
  const annas = Boolean(useAnnasKey())
  const trimmed = query.trim()

  return useInfiniteQuery({
    queryKey: [...queryKeys.ebookSearch(trimmed, annas), 'pages'],
    queryFn: ({ pageParam, signal }) => searchEbooksPage(trimmed, pageParam, signal),
    initialPageParam: firstEbookPage,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    enabled: trimmed.length >= 2,
  })
}

/** Downloads an e-book onto the phone that belongs to no book, such as one found in Search. */
export function useDownloadEbook() {
  return useMutation({ mutationFn: (result: EbookResult) => downloadEbook(result, null) })
}

/** Makes a file the one a Hardcover book is read in; nothing is downloaded. */
export function useChooseEbook(workId: string) {
  return useMutation({ mutationFn: (result: EbookResult) => chooseEbook(result, workId) })
}

/**
 * Downloads a book's e-book to read it, kept on the phone as the Storage sheet keeps one, and puts
 * the book in the library, as listening does.
 */
export function useFetchEbook(workId: string, hardcover: HardcoverWork | null) {
  return useMutation({
    mutationFn: async (result: EbookResult) => {
      await setWorkInLibrary(workId, hardcover, true)
      await downloadEbook(result, workId)
    },
    onSettled: () => invalidateLibrary(),
  })
}

/** Keeps a book's e-book on the phone to read offline. */
export function useKeepEbook(workId: string) {
  return useMutation({
    mutationFn: (result: EbookResult) => downloadEbook(result, workId),
  })
}

/** Where finding e-books for a book has got to, for one clear status while none is chosen. */
export type EbookFinding = 'searching' | 'failed' | 'none' | null

/**
 * A Hardcover book's e-book: the file last chosen for it, or else the best one found, searched
 * by its title and first author, or by its title alone when that finds nothing. With `search`
 * off, a book whose file is already chosen is not searched again.
 */
export function useWorkEbooks(hardcoverId: number, search: boolean) {
  const workId = hardcoverWorkId(hardcoverId)
  const work = useHardcoverWork(hardcoverId)
  const data = work.data
  const title = data ? splitTitle(data.title, data.subtitle).title : ''
  const authors = data?.authors ?? []

  // The latest choice first, then files kept for the book before choices were remembered.
  const kept = [...useEbooks().values()]
    .filter((ebook) => ebook.workId === workId)
    .sort((a, b) => (b.chosenAt ?? 0) - (a.chosenAt ?? 0) || b.addedAt - a.addedAt)

  const chosen: Ebook | null = kept[0] ?? null
  const searching = Boolean(data) && (search || chosen === null)
  const precise = useEbookSearch(`${title} ${authors[0] ?? ''}`, searching)
  const empty = precise.isSuccess && precise.data.length === 0
  const broad = useEbookSearch(title, searching && empty)
  const found = empty ? broad : precise

  const results = rankEbooks(
    found.data ?? [],
    { title, authors },
    usePreferences().preferredLanguage,
  )

  const finding: EbookFinding =
    !data || (searching && found.isPending)
      ? 'searching'
      : found.error && results.length === 0
        ? 'failed'
        : chosen === null && results.length === 0
          ? 'none'
          : null

  const choose = useChooseEbook(workId)
  const fetch = useFetchEbook(workId, data ?? null)
  const keep = useKeepEbook(workId)

  return {
    workId,
    work,
    chosen,
    /** What Read opens: the chosen file, or the best one found until one is chosen. */
    choice: chosen ? ebookResultOf(chosen) : (results[0] ?? null),
    results,
    finding,
    search: found,
    choose,
    fetch,
    keep,
  }
}

export function useEbookMarks(md5: string) {
  return useQuery({
    queryKey: queryKeys.ebookMarks(md5),
    queryFn: () => listMarks(md5),
    ...local,
  })
}

function invalidateMarks(md5: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.ebookMarks(md5) })
}

export function useAddMark(md5: string) {
  return useMutation({
    mutationFn: (mark: Omit<EbookMark, 'id' | 'createdAt' | 'md5'>) => addMark({ ...mark, md5 }),
    onSettled: () => invalidateMarks(md5),
  })
}

export function useUpdateMark(md5: string) {
  return useMutation({
    mutationFn: ({ id, ...changes }: Pick<EbookMark, 'id' | 'note' | 'color'>) =>
      updateMark(id, changes),
    onSettled: () => invalidateMarks(md5),
  })
}

export function useDeleteMark(md5: string) {
  return useMutation({
    mutationFn: deleteMark,
    onSettled: () => invalidateMarks(md5),
  })
}
