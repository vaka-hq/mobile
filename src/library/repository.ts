import { z } from 'zod'
import { type AbbBook, abbBookSchema } from '@/sources/audiobookbay/parse'
import {
  type HardcoverBook,
  type HardcoverWork,
  hardcoverBookSchema,
  hardcoverWorkSchema,
} from '@/sources/hardcover/client'
import { type Track, trackSchema } from '@/sources/torbox/tracks'
import { database } from './database'
import {
  type BookRecord,
  type Bookmark,
  type Chapter,
  chapterSchema,
  hardcoverWorkId,
  type LibraryEntry,
  type MatchState,
  matchStates,
  type Playback,
  type StreamEntry,
  type WorkRecord,
  workIdOf,
} from './model'

type BookRow = {
  id: string
  abb: string
  abb_fetched_at: number
  hardcover_id: number | null
  hardcover: string | null
  match_state: string
  torrent_id: number | null
  tracks: string | null
  durations: string | null
  chapters: string | null
  last_played_at: number | null
}

type WorkRow = {
  id: string
  hardcover_id: number | null
  work: string | null
  stream_id: string | null
  in_library: number
  added_at: number | null
  last_played_at: number | null
  finished_at: number | null
}

type PlaybackRow = {
  book_id: string
  track: number
  position: number
  speed: number
  finished: number
  updated_at: number
}

type BookmarkRow = {
  id: number
  book_id: string
  track: number
  position: number
  note: string | null
  created_at: number
}

/** A stream joined with its optional progress row. */
type EntryRow = BookRow & {
  p_book_id: string | null
  p_track: number | null
  p_position: number | null
  p_speed: number | null
  p_finished: number | null
  p_updated_at: number | null
}

/** Cached JSON is re-validated on read; a stale or corrupt column is treated as missing. */
function column<T extends z.ZodType>(value: string | null, schema: T): z.infer<T> | null {
  if (value === null) {
    return null
  }

  try {
    const parsed = schema.safeParse(JSON.parse(value))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const matchState = z.enum(matchStates).catch('pending')

function toBook(row: BookRow): BookRecord | null {
  const abb = column(row.abb, abbBookSchema)

  if (!abb) {
    return null
  }

  return {
    id: row.id,
    abb,
    abbFetchedAt: row.abb_fetched_at,
    hardcoverId: row.hardcover_id,
    hardcover: column(row.hardcover, hardcoverBookSchema),
    matchState: matchState.parse(row.match_state),
    torrentId: row.torrent_id,
    tracks: column(row.tracks, z.array(trackSchema)),
    durations: column(row.durations, z.array(z.number().nullable())),
    chapters: column(row.chapters, z.array(chapterSchema)),
    lastPlayedAt: row.last_played_at,
  }
}

function toWork(row: WorkRow): WorkRecord {
  return {
    id: row.id,
    hardcoverId: row.hardcover_id,
    work: column(row.work, hardcoverWorkSchema),
    streamId: row.stream_id,
    inLibrary: row.in_library === 1,
    addedAt: row.added_at,
    lastPlayedAt: row.last_played_at,
    finishedAt: row.finished_at,
  }
}

function toPlayback(row: PlaybackRow): Playback {
  return {
    bookId: row.book_id,
    track: row.track,
    position: row.position,
    speed: row.speed,
    finished: row.finished === 1,
    updatedAt: row.updated_at,
  }
}

function toBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    bookId: row.book_id,
    track: row.track,
    position: row.position,
    note: row.note,
    createdAt: row.created_at,
  }
}

export async function getBook(id: string) {
  const row = await database.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ?', id)

  return row ? toBook(row) : null
}

/** Stores the latest AudioBookBay details without touching links, progress or library state. */
export async function saveAbb(abb: AbbBook) {
  await database.runAsync(
    `INSERT INTO books (id, abb, abb_fetched_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET abb = excluded.abb, abb_fetched_at = excluded.abb_fetched_at,
     updated_at = excluded.updated_at`,
    abb.id,
    JSON.stringify(abb),
    Date.now(),
    Date.now(),
  )
}

export async function saveHardcover(id: string, state: MatchState, book: HardcoverBook | null) {
  await database.runAsync(
    'UPDATE books SET hardcover_id = ?, hardcover = ?, match_state = ?, updated_at = ? WHERE id = ?',
    book?.id ?? null,
    book ? JSON.stringify(book) : null,
    state,
    Date.now(),
    id,
  )
}

/**
 * Unlinks a recording from every book but `workId`, such as after the listener matched it to
 * another book: those books then choose their recording afresh.
 */
export async function unlinkStream(streamId: string, workId: string) {
  await database.runAsync(
    'UPDATE works SET stream_id = NULL, updated_at = ? WHERE stream_id = ? AND id != ?',
    Date.now(),
    streamId,
    workId,
  )
}

/** Remembers the listener's torrent as soon as TorBox creates it; files follow once it is ready. */
export async function saveTorrentId(id: string, torrentId: number) {
  await database.runAsync(
    'UPDATE books SET torrent_id = ?, updated_at = ? WHERE id = ?',
    torrentId,
    Date.now(),
    id,
  )
}

/** Forgets a book's torrent, such as one removed from TorBox, so it can be added again. */
export async function clearTorrent(id: string) {
  await database.runAsync(
    'UPDATE books SET torrent_id = NULL, updated_at = ? WHERE id = ?',
    Date.now(),
    id,
  )
}

/** Forgets a torrent removed from TorBox on every upload that used it. */
export async function clearTorrentId(torrentId: number) {
  await database.runAsync(
    'UPDATE books SET torrent_id = NULL, updated_at = ? WHERE torrent_id = ?',
    Date.now(),
    torrentId,
  )
}

/** Uploads added to TorBox whose files are not known yet, so they may still be downloading. */
export async function listPendingTorrents() {
  const rows = await database.getAllAsync<{ torrent_id: number }>(
    'SELECT DISTINCT torrent_id FROM books WHERE torrent_id IS NOT NULL AND tracks IS NULL',
  )

  return rows.map((row) => row.torrent_id)
}

/**
 * The torrents this app added to TorBox, by ID and by lowercased info hash, so the listener's
 * other torrents are left alone.
 */
export async function appTorrents() {
  const rows = await database.getAllAsync<{ torrent_id: number | null; hash: string | null }>(
    `SELECT torrent_id, lower(json_extract(abb, '$.infoHash')) AS hash FROM books
     WHERE torrent_id IS NOT NULL OR id IN (SELECT book_id FROM offline_books)
       OR last_played_at IS NOT NULL`,
  )

  return {
    ids: new Set(rows.flatMap((row) => (row.torrent_id === null ? [] : [row.torrent_id]))),
    hashes: new Set(rows.flatMap((row) => (row.hash === null ? [] : [row.hash]))),
  }
}

/** A new torrent replaces the old file list, so its measured timeline is reset as well. */
export async function saveTorrent(id: string, torrentId: number, tracks: Track[]) {
  await database.runAsync(
    `UPDATE books SET torrent_id = ?, tracks = ?, durations = NULL, chapters = NULL, updated_at = ?
     WHERE id = ?`,
    torrentId,
    JSON.stringify(tracks),
    Date.now(),
    id,
  )
}

export async function saveTimeline(id: string, durations: (number | null)[], chapters: Chapter[]) {
  await database.runAsync(
    'UPDATE books SET durations = ?, chapters = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(durations),
    JSON.stringify(chapters),
    Date.now(),
    id,
  )
}

export async function saveTrackDuration(id: string, track: number, duration: number) {
  const book = await getBook(id)

  if (!book?.tracks) {
    return
  }

  const durations = book.durations ?? book.tracks.map(() => null)

  if (durations[track] !== null && Math.abs((durations[track] ?? 0) - duration) < 1) {
    return
  }

  durations[track] = duration

  await database.runAsync(
    'UPDATE books SET durations = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(durations),
    Date.now(),
    id,
  )
}

export async function getWork(id: string) {
  const row = await database.getFirstAsync<WorkRow>('SELECT * FROM works WHERE id = ?', id)

  return row ? toWork(row) : null
}

/** Creates the book's row on first use, keeping Hardcover's details for the library. */
async function ensureWork(id: string, hardcover: HardcoverWork | null) {
  await database.runAsync(
    `INSERT INTO works (id, hardcover_id, work, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET work = coalesce(excluded.work, works.work),
     hardcover_id = coalesce(excluded.hardcover_id, works.hardcover_id),
     updated_at = excluded.updated_at`,
    id,
    hardcover?.id ?? null,
    hardcover ? JSON.stringify(hardcover) : null,
    Date.now(),
  )
}

export async function setWorkInLibrary(
  id: string,
  hardcover: HardcoverWork | null,
  inLibrary: boolean,
) {
  await ensureWork(id, hardcover)
  await database.runAsync(
    `UPDATE works SET in_library = ?, added_at = CASE WHEN ? THEN coalesce(added_at, ?) ELSE NULL END,
     updated_at = ? WHERE id = ?`,
    inLibrary ? 1 : 0,
    inLibrary ? 1 : 0,
    Date.now(),
    Date.now(),
    id,
  )
}

/** Remembers the stream the listener picked for a book. */
export async function chooseStream(id: string, hardcover: HardcoverWork | null, streamId: string) {
  await ensureWork(id, hardcover)
  await database.runAsync(
    'UPDATE works SET stream_id = ?, updated_at = ? WHERE id = ?',
    streamId,
    Date.now(),
    id,
  )
}

/**
 * Playing a stream adds its book to the library and moves it to the front of the books being
 * listened to. It becomes the book's chosen stream only when none was chosen: a listener who
 * picked another source and then resumes the old one from the mini player keeps their pick.
 */
export async function markPlayed(streamId: string) {
  const book = await getBook(streamId)

  if (!book) {
    return
  }

  const now = Date.now()
  const workId = workIdOf(book)

  await database.runAsync(
    'UPDATE books SET last_played_at = ?, updated_at = ? WHERE id = ?',
    now,
    now,
    streamId,
  )
  await ensureWork(workId, null)
  await database.runAsync(
    `UPDATE works SET stream_id = coalesce(stream_id, ?), hardcover_id = coalesce(hardcover_id, ?),
     last_played_at = ?, finished_at = NULL,
     in_library = 1, added_at = coalesce(added_at, ?), updated_at = ? WHERE id = ?`,
    streamId,
    book.hardcoverId,
    now,
    now,
    now,
    workId,
  )
}

/** Forgets a book with the progress and bookmarks of every stream of it. */
/**
 * The works a book is kept under: its own and any upload's matched to the same Hardcover book,
 * which the listener may have played before the match. Removing the book removes them all.
 */
export async function worksOfBook(id: string) {
  const rows = await database.getAllAsync<{ id: string }>(
    `SELECT id FROM works WHERE id = ?1
     OR (hardcover_id IS NOT NULL AND hardcover_id = (SELECT hardcover_id FROM works WHERE id = ?1))`,
    id,
  )

  return [...new Set([id, ...rows.map((row) => row.id)])]
}

/**
 * Forgets what was saved while listening to one recording: where it stopped and its bookmarks. A
 * recording listened to the end leaves its book marked finished, so it does not look unstarted.
 */
export async function forgetStreamProgress(bookId: string) {
  const book = await getBook(bookId)
  const playback = await getPlayback(bookId)
  const now = Date.now()

  await database.withExclusiveTransactionAsync(async (txn) => {
    if (book && playback?.finished) {
      await txn.runAsync(
        'UPDATE works SET finished_at = coalesce(finished_at, ?), updated_at = ? WHERE id = ?',
        now,
        now,
        workIdOf(book),
      )
    }

    await txn.runAsync('DELETE FROM playback WHERE book_id = ?', bookId)
    await txn.runAsync('DELETE FROM bookmarks WHERE book_id = ?', bookId)
    await txn.runAsync(
      'UPDATE books SET last_played_at = NULL, updated_at = ? WHERE id = ?',
      now,
      bookId,
    )
  })
}

/** The recordings of a Hardcover book kept on the phone, the one kept last first. */
export async function keptStreamsOf(hardcoverId: number) {
  const rows = await database.getAllAsync<{ id: string }>(
    `SELECT offline_books.book_id AS id FROM offline_books
     JOIN books ON books.id = offline_books.book_id
     WHERE books.hardcover_id = ? AND offline_books.status = 'done'
     ORDER BY offline_books.updated_at DESC`,
    hardcoverId,
  )

  return rows.map((row) => row.id)
}

/** The library's works of these Hardcover books, under their own IDs or an upload's. */
export async function libraryWorksOf(hardcoverIds: number[]) {
  if (hardcoverIds.length === 0) {
    return []
  }

  const marks = hardcoverIds.map(() => '?').join(', ')

  const rows = await database.getAllAsync<{ id: string }>(
    `SELECT id FROM works WHERE in_library = 1
     AND (hardcover_id IN (${marks}) OR id IN (${marks}))`,
    ...hardcoverIds,
    ...hardcoverIds.map(hardcoverWorkId),
  )

  return rows.map((row) => row.id)
}

/** The streams whose listening belongs to a work. */
export async function streamsOfWork(id: string) {
  const rows = await database.getAllAsync<{ id: string }>(workStreams, id)

  return rows.map((row) => row.id)
}

/**
 * Takes a book out of the library with all its listening: where it stopped, whether it was
 * finished, and its bookmarks. Its details stay, so its page still shows.
 */
export async function removeWorkFromLibrary(id: string) {
  const now = Date.now()

  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`DELETE FROM playback WHERE book_id IN (${workStreams})`, id)
    await txn.runAsync(`DELETE FROM bookmarks WHERE book_id IN (${workStreams})`, id)
    await txn.runAsync(
      `UPDATE books SET last_played_at = NULL, updated_at = ?2 WHERE id IN (${workStreams})`,
      id,
      now,
    )
    await txn.runAsync(
      `UPDATE works SET in_library = 0, added_at = NULL, finished_at = NULL, last_played_at = NULL,
       updated_at = ? WHERE id = ?`,
      now,
      id,
    )
  })
}

function toPlaybackColumns(row: EntryRow) {
  return row.p_book_id === null
    ? null
    : toPlayback({
        book_id: row.p_book_id,
        track: row.p_track ?? 0,
        position: row.p_position ?? 0,
        speed: row.p_speed ?? 1,
        finished: row.p_finished ?? 0,
        updated_at: row.p_updated_at ?? 0,
      })
}

const playbackColumns = `playback.book_id AS p_book_id, playback.track AS p_track,
  playback.position AS p_position, playback.speed AS p_speed, playback.finished AS p_finished,
  playback.updated_at AS p_updated_at`

/** A work row with its stream's columns prefixed, since both tables share names. */
type LibraryRow = EntryRow & {
  w_id: string
  w_hardcover_id: number | null
  w_work: string | null
  w_stream_id: string | null
  w_in_library: number
  w_added_at: number | null
  w_last_played_at: number | null
  w_finished_at: number | null
}

/**
 * Books with the stream they are listened to from: the one played last, which can differ from the
 * source chosen on the book's page until the listener changes to it, else the chosen one.
 */
async function libraryEntries(where: string, order: string, ...params: (string | number)[]) {
  const rows = await database.getAllAsync<LibraryRow>(
    `SELECT books.*, ${playbackColumns}, works.id AS w_id, works.hardcover_id AS w_hardcover_id,
     works.work AS w_work, works.stream_id AS w_stream_id, works.in_library AS w_in_library,
     works.added_at AS w_added_at, works.last_played_at AS w_last_played_at,
     works.finished_at AS w_finished_at
     FROM works
     LEFT JOIN books ON books.id = coalesce(
       (SELECT played.id FROM books AS played
        WHERE played.last_played_at IS NOT NULL
          AND (played.id = works.stream_id
            OR (works.hardcover_id IS NOT NULL AND played.hardcover_id = works.hardcover_id))
        ORDER BY played.last_played_at DESC LIMIT 1),
       works.stream_id)
     LEFT JOIN playback ON playback.book_id = books.id
     WHERE ${where} ORDER BY ${order}`,
    ...params,
  )

  return rows.map((row): LibraryEntry => {
    const book = row.id ? toBook(row) : null

    return {
      work: toWork({
        id: row.w_id,
        hardcover_id: row.w_hardcover_id,
        work: row.w_work,
        stream_id: row.w_stream_id,
        in_library: row.w_in_library,
        added_at: row.w_added_at,
        last_played_at: row.w_last_played_at,
        finished_at: row.w_finished_at,
      }),
      book,
      playback: book ? toPlaybackColumns(row) : null,
    }
  })
}

export function listLibrary() {
  return libraryEntries(
    'works.in_library = 1',
    'coalesce(works.last_played_at, works.added_at) DESC',
  )
}

/** The streams played most recently, for restoring the player after a cold start. */
export async function listRecentStreams(limit: number) {
  const rows = await database.getAllAsync<EntryRow>(
    `SELECT books.*, ${playbackColumns} FROM books
     LEFT JOIN playback ON playback.book_id = books.id
     WHERE books.last_played_at IS NOT NULL
     ORDER BY books.last_played_at DESC LIMIT ?`,
    limit,
  )

  return rows.flatMap((row): StreamEntry[] => {
    const book = toBook(row)

    return book ? [{ book, playback: toPlaybackColumns(row) }] : []
  })
}

export async function getPlayback(bookId: string) {
  const row = await database.getFirstAsync<PlaybackRow>(
    'SELECT * FROM playback WHERE book_id = ?',
    bookId,
  )

  return row ? toPlayback(row) : null
}

export async function savePlayback(playback: Omit<Playback, 'updatedAt'>) {
  await database.runAsync(
    `INSERT INTO playback (book_id, track, position, speed, finished, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id) DO UPDATE SET track = excluded.track, position = excluded.position,
     speed = excluded.speed, finished = excluded.finished, updated_at = excluded.updated_at`,
    playback.bookId,
    playback.track,
    playback.position,
    playback.speed,
    playback.finished ? 1 : 0,
    Date.now(),
  )
}

export async function listBookmarks(bookId: string) {
  const rows = await database.getAllAsync<BookmarkRow>(
    'SELECT * FROM bookmarks WHERE book_id = ? ORDER BY track, position',
    bookId,
  )

  return rows.map(toBookmark)
}

export async function addBookmark(
  bookId: string,
  track: number,
  position: number,
  note: string | null,
) {
  await database.runAsync(
    'INSERT INTO bookmarks (book_id, track, position, note, created_at) VALUES (?, ?, ?, ?, ?)',
    bookId,
    track,
    position,
    note,
    Date.now(),
  )
}

/** Writes a bookmark's note, or clears it with null. */
export async function saveBookmarkNote(id: number, note: string | null) {
  await database.runAsync('UPDATE bookmarks SET note = ? WHERE id = ?', note, id)
}

export async function deleteBookmark(id: number) {
  await database.runAsync('DELETE FROM bookmarks WHERE id = ?', id)
}

/**
 * Streams kept only because they were browsed: not played, used by no book, not on the phone,
 * not added to TorBox and without progress or bookmarks, all of which would go with them.
 */
const browsedBooks = `last_played_at IS NULL AND torrent_id IS NULL
  AND id NOT IN (SELECT stream_id FROM works WHERE stream_id IS NOT NULL)
  AND id NOT IN (SELECT book_id FROM offline_books)
  AND id NOT IN (SELECT book_id FROM playback)
  AND id NOT IN (SELECT book_id FROM bookmarks)`

/**
 * Roughly how many bytes `clearCachedMetadata` would free: the cached answers and the books and
 * uploads kept only because they were browsed.
 */
export async function cachedMetadataSize() {
  const row = await database.getFirstAsync<{ bytes: number | null }>(
    `SELECT
       (SELECT coalesce(sum(length(CAST(key AS BLOB)) + length(CAST(value AS BLOB))), 0)
          FROM request_cache)
     + (SELECT coalesce(sum(length(CAST(coalesce(work, '') AS BLOB))), 0)
          FROM works WHERE ${browsedWorks})
     + (SELECT coalesce(sum(
           length(CAST(abb AS BLOB)) + length(CAST(coalesce(hardcover, '') AS BLOB))
           + length(CAST(coalesce(tracks, '') AS BLOB))
           + length(CAST(coalesce(durations, '') AS BLOB))
           + length(CAST(coalesce(chapters, '') AS BLOB))), 0)
          FROM books WHERE ${browsedBooks}) AS bytes`,
  )

  return row?.bytes ?? 0
}

/** Works only browsed: not in the library, never played, and read in no e-book. */
const browsedWorks = `in_library = 0 AND last_played_at IS NULL AND finished_at IS NULL
  AND id NOT IN (SELECT work_id FROM ebooks WHERE work_id IS NOT NULL)`

/** Forgets browsed streams and books; streams a library book uses and played ones stay. */
export async function clearCachedMetadata() {
  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`DELETE FROM works WHERE ${browsedWorks}`)
    await txn.runAsync(`DELETE FROM books WHERE ${browsedBooks}`)
    await txn.runAsync('DELETE FROM request_cache')
  })
}

/** The most the cached answers take together, in bytes, before the least used go. */
const cacheBudget = 16 * 1024 * 1024

/**
 * How long an expired answer is kept to fall back on when a fresh one cannot be had, such as
 * offline. Within the budget, the least recently used go first either way.
 */
const staleKept = 30 * 24 * 60 * 60 * 1000

/** How many books and works kept only because they were browsed stay, the latest first. */
const browsedKept = 300

/** How long a use keeps counting as recent, so reading an answer rarely writes. */
const useGranularity = 60 * 1000

/**
 * A cached answer still within its lifetime, as stored; the caller validates it. Reading it marks
 * it used, at most once a minute, so answers in use outlast those not asked for again.
 */
export async function getCachedResponse(key: string) {
  const now = Date.now()

  const row = await database.getFirstAsync<{ value: string; used_at: number }>(
    'SELECT value, used_at FROM request_cache WHERE key = ? AND expires_at > ?',
    key,
    now,
  )

  if (row && now - row.used_at > useGranularity) {
    await database.runAsync('UPDATE request_cache SET used_at = ? WHERE key = ?', now, key)
  }

  return row?.value ?? null
}

/** A cached answer however old, for when a fresh one cannot be had, such as offline. */
export async function getStaleCachedResponse(key: string) {
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM request_cache WHERE key = ?',
    key,
  )

  return row?.value ?? null
}

export async function saveCachedResponse(key: string, value: string, expiresAt: number) {
  await database.runAsync(
    'INSERT OR REPLACE INTO request_cache (key, value, expires_at, used_at) VALUES (?, ?, ?, ?)',
    key,
    value,
    expiresAt,
    Date.now(),
  )
}

/**
 * Keeps the cache within bounds: answers expired for a month go, then the least recently used
 * until the rest fit the budget; and of the books and works kept only because they were browsed, the oldest
 * past a few hundred go. Books in the library, played, bookmarked or kept on the phone never do.
 */
export async function pruneCachedResponses() {
  const now = Date.now()

  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM request_cache WHERE expires_at <= ?', now - staleKept)
    await txn.runAsync(
      `DELETE FROM request_cache WHERE key IN (
         SELECT key FROM (
           SELECT key, sum(length(CAST(value AS BLOB))) OVER (
             ORDER BY used_at DESC, key ROWS UNBOUNDED PRECEDING
           ) AS total FROM request_cache
         ) WHERE total > ?
       )`,
      cacheBudget,
    )
    await txn.runAsync(
      `DELETE FROM books WHERE id IN (
         SELECT id FROM books WHERE ${browsedBooks}
         ORDER BY abb_fetched_at DESC LIMIT -1 OFFSET ?
       )`,
      browsedKept,
    )
    await txn.runAsync(
      `DELETE FROM works WHERE id IN (
         SELECT id FROM works WHERE ${browsedWorks}
         ORDER BY updated_at DESC LIMIT -1 OFFSET ?
       )`,
      browsedKept,
    )
  })
}

/** A series whose books all belong in the library, with the books already added for it. */
export type FollowedSeries = { id: number; name: string; knownBooks: number[]; addedAt: number }

type SeriesRow = { id: number; name: string; known_books: string; added_at: number }

function toSeries(row: SeriesRow): FollowedSeries {
  return {
    id: row.id,
    name: row.name,
    knownBooks: column(row.known_books, z.array(z.number())) ?? [],
    addedAt: row.added_at,
  }
}

export async function listFollowedSeries() {
  const rows = await database.getAllAsync<SeriesRow>('SELECT * FROM series ORDER BY name')

  return rows.map(toSeries)
}

export async function getFollowedSeries(id: number) {
  const row = await database.getFirstAsync<SeriesRow>('SELECT * FROM series WHERE id = ?', id)

  return row ? toSeries(row) : null
}

/** Remembers the series as wholly in the library, with the books added for it so far. */
export async function saveFollowedSeries(id: number, name: string, knownBooks: number[]) {
  const now = Date.now()

  await database.runAsync(
    `INSERT INTO series (id, name, known_books, added_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, known_books = excluded.known_books,
     updated_at = excluded.updated_at`,
    id,
    name,
    JSON.stringify(knownBooks),
    now,
    now,
  )
}

export async function deleteFollowedSeries(id: number) {
  await database.runAsync('DELETE FROM series WHERE id = ?', id)
}

/**
 * The stream of a book listened to last: the one among its streams whose place was saved most
 * recently, which need not be the one chosen for it.
 */
export async function lastHeardStream(workId: string) {
  const row = await database.getFirstAsync<{ book_id: string }>(
    `SELECT book_id FROM playback WHERE book_id IN (${workStreams})
     ORDER BY updated_at DESC LIMIT 1`,
    workId,
  )

  return row?.book_id ?? null
}

/** The streams of a book: its chosen one, and for a Hardcover book every upload linked to it. */
const workStreams = `SELECT id FROM books WHERE id = (SELECT stream_id FROM works WHERE id = ?1)
  OR (hardcover_id IS NOT NULL AND hardcover_id = (SELECT hardcover_id FROM works WHERE id = ?1))`

/**
 * Marks the book finished, putting it in the library if it is not there: its chosen stream
 * counts as listened to the end, so playing it again starts over.
 */
export async function markWorkFinished(id: string, hardcover: HardcoverWork | null) {
  const now = Date.now()

  await ensureWork(id, hardcover)
  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `UPDATE works SET finished_at = ?, in_library = 1, added_at = coalesce(added_at, ?),
       updated_at = ? WHERE id = ?`,
      now,
      now,
      now,
      id,
    )
    await txn.runAsync(
      `INSERT INTO playback (book_id, track, position, speed, finished, updated_at)
       SELECT stream_id, 0, 0, 1, 1, ? FROM works WHERE id = ? AND stream_id IS NOT NULL
       ON CONFLICT (book_id) DO UPDATE SET finished = 1, updated_at = excluded.updated_at`,
      now,
      id,
    )
  })
}

/** Forgets every trace of listening to the book, so it counts as not started. */
export async function markWorkNotStarted(id: string) {
  const now = Date.now()

  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(`DELETE FROM playback WHERE book_id IN (${workStreams})`, id)
    await txn.runAsync(
      `UPDATE books SET last_played_at = NULL, updated_at = ?2 WHERE id IN (${workStreams})`,
      id,
      now,
    )
    await txn.runAsync(
      'UPDATE works SET finished_at = NULL, last_played_at = NULL, updated_at = ? WHERE id = ?',
      now,
      id,
    )
  })
}
