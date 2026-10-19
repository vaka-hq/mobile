import { z } from 'zod'
import {
  type HardcoverShelfEntry,
  type HardcoverWork,
  shelfStatus,
} from '@/sources/hardcover/client'
import { database } from './database'
import { type BookRecord, hardcoverWorkId } from './model'
import {
  getBook,
  getPlayback,
  lastHeardStream,
  markWorkFinished,
  savePlayback,
  setWorkInLibrary,
} from './repository'
import type { LocalBook, ShelfBaseline } from './shelf-sync'
import { bookDuration, knownPosition, locate } from './timeline'

/**
 * What the last sync left of the listener's Hardcover shelves, and the library as the shelves see
 * it: books by their Hardcover ID.
 */

const baselineRow = z.object({
  book_id: z.number(),
  user_book_id: z.number(),
  status: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  read_id: z.number().nullable(),
  progress_seconds: z.number().nullable(),
  edition_id: z.number().nullable(),
  edition_seconds: z.number().nullable(),
  synced_at: z.number(),
})

/** A baseline with the edition its place is counted in, to start a recording of another there. */
export type StoredBaseline = ShelfBaseline & {
  editionId: number | null
  editionSeconds: number | null
}

export async function shelfBaselines() {
  const rows = await database.getAllAsync('SELECT * FROM hardcover_shelf')
  const baselines = new Map<number, StoredBaseline>()

  for (const value of rows) {
    const row = baselineRow.safeParse(value)

    if (row.success) {
      baselines.set(row.data.book_id, {
        userBookId: row.data.user_book_id,
        status: row.data.status,
        readId: row.data.read_id,
        progressSeconds: row.data.progress_seconds,
        syncedAt: row.data.synced_at,
        editionId: row.data.edition_id,
        editionSeconds: row.data.edition_seconds,
      })
    }
  }

  return baselines
}

/** Keeps a book's shelf entry as it now stands there; none forgets the book. */
export async function saveShelfBaseline(
  bookId: number,
  entry: HardcoverShelfEntry | null,
  syncedAt: number,
) {
  if (!entry) {
    await database.runAsync('DELETE FROM hardcover_shelf WHERE book_id = ?', bookId)

    return
  }

  await database.runAsync(
    `INSERT INTO hardcover_shelf (book_id, user_book_id, status, read_id, progress_seconds,
     edition_id, edition_seconds, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (book_id) DO UPDATE SET user_book_id = excluded.user_book_id,
     status = excluded.status, read_id = excluded.read_id,
     progress_seconds = excluded.progress_seconds, edition_id = excluded.edition_id,
     edition_seconds = excluded.edition_seconds, synced_at = excluded.synced_at`,
    bookId,
    entry.userBookId,
    entry.status,
    entry.read?.id ?? null,
    entry.read?.progressSeconds ?? null,
    entry.read?.editionId ?? entry.editionId,
    entry.read?.editionSeconds ?? null,
    syncedAt,
  )
}

/** Forgets the shelves, for sync turned off or a key for another account. */
export async function forgetShelves() {
  await database.runAsync('DELETE FROM hardcover_shelf')
}

/** A book of the library with a Hardcover ID, as the planner and the changes it makes see it. */
export type ShelfBook = {
  workId: string
  hasDetails: boolean
  local: LocalBook
  /** The recording listened to last, else the chosen one: where Hardcover's place is put. */
  streamId: string | null
}

const workRow = z.object({
  id: z.string(),
  hardcover_id: z.number(),
  work: z.string().nullable(),
  stream_id: z.string().nullable(),
  in_library: z.number(),
  finished_at: z.number().nullable(),
  last_played_at: z.number().nullable(),
})

async function listeningOf(streamId: string | null) {
  const book = streamId ? await getBook(streamId) : null
  const playback = streamId ? await getPlayback(streamId) : null

  if (!book || !playback) {
    return { playback, listening: null }
  }

  const durations = book.durations ?? []
  const seconds = knownPosition(durations, playback.track, playback.position)

  return {
    playback,
    listening:
      seconds === null || playback.finished
        ? null
        : {
            seconds,
            savedAt: playback.updatedAt,
            editionId: book.hardcover?.edition?.id ?? null,
            recordingSeconds: bookDuration(durations),
          },
  }
}

/**
 * Every book with a Hardcover ID, by that ID. Uploads matched to the same book are kept under
 * their own works too; the one in the library, else the one played last, speaks for the book.
 */
export async function shelfBooks() {
  const rows = await database.getAllAsync(
    `SELECT id, hardcover_id, work, stream_id, in_library, finished_at, last_played_at
     FROM works WHERE hardcover_id IS NOT NULL
     ORDER BY in_library DESC, coalesce(last_played_at, 0) DESC`,
  )

  const books = new Map<number, ShelfBook>()

  for (const value of rows) {
    const row = workRow.safeParse(value)

    if (!row.success || books.has(row.data.hardcover_id)) {
      continue
    }

    const streamId = (await lastHeardStream(row.data.id)) ?? row.data.stream_id
    const { playback, listening } = await listeningOf(streamId)
    // A recording heard to the end leaves its book finished, though not marked so by hand.
    const heardOut = playback?.finished ? playback.updatedAt : null

    books.set(row.data.hardcover_id, {
      workId: row.data.id,
      hasDetails: row.data.work !== null,
      streamId,
      local: {
        inLibrary: row.data.in_library === 1,
        finishedAt: row.data.finished_at ?? heardOut,
        playedAt: row.data.last_played_at,
        listening,
      },
    })
  }

  return books
}

/** Puts a book Hardcover has on its shelves in the library, with its details. */
export async function addFromShelves(workId: string, work: HardcoverWork) {
  await setWorkInLibrary(workId, work, true)
}

export async function finishFromShelves(workId: string, work: HardcoverWork | null) {
  await markWorkFinished(workId, work)
}

/**
 * Takes a book taken off the Hardcover shelves out of the library. Unlike removing it here, its
 * listening and bookmarks stay, should it come back.
 */
export async function leaveFromShelves(workId: string) {
  await database.runAsync(
    'UPDATE works SET in_library = 0, updated_at = ? WHERE id = ?',
    Date.now(),
    workId,
  )
}

/**
 * Seconds into a recording for a place Hardcover counts in an edition: the same seconds in the
 * same edition, else the same share of the book when both lengths are known.
 */
function secondsIn(
  book: BookRecord,
  seconds: number,
  editionId: number | null,
  editionSeconds: number | null,
) {
  const durations = book.durations ?? []
  const length = bookDuration(durations)

  if (length === null) {
    return null
  }

  const ownEdition = book.hardcover?.edition?.id ?? null

  if (ownEdition !== editionId && editionSeconds) {
    return Math.min(1, seconds / editionSeconds) * length
  }

  return Math.min(seconds, length)
}

/**
 * Moves listening to the place Hardcover has, for the recording listened to last. One whose
 * files' lengths are not all known yet is left; it starts at Hardcover's place when it opens.
 */
export async function moveFromShelves(
  workId: string,
  streamId: string | null,
  seconds: number,
  editionId: number | null,
  editionSeconds: number | null,
) {
  const book = streamId ? await getBook(streamId) : null

  if (!book?.durations) {
    return false
  }

  const into = secondsIn(book, seconds, editionId, editionSeconds)

  if (into === null) {
    return false
  }

  const place = locate(book.durations, into)
  const speed = (await getPlayback(book.id))?.speed ?? 1
  const now = Date.now()

  await savePlayback({ bookId: book.id, ...place, speed, finished: false })
  await database.runAsync(
    'UPDATE works SET finished_at = NULL, updated_at = ? WHERE id = ?',
    now,
    workId,
  )

  return true
}

/**
 * Where a recording never played here starts: at the place Hardcover has for its book, when the
 * book is being listened to there and the recording's length is known. Null to start at the top.
 */
export async function shelfStart(book: BookRecord) {
  if (book.hardcoverId === null || !book.durations) {
    return null
  }

  const baseline = (await shelfBaselines()).get(book.hardcoverId)

  if (!baseline || baseline.progressSeconds === null || baseline.status === shelfStatus.read) {
    return null
  }

  const into = secondsIn(
    book,
    baseline.progressSeconds,
    baseline.editionId,
    baseline.editionSeconds,
  )

  return into === null ? null : locate(book.durations, into)
}

/** The work a Hardcover book is kept under here, or would be. */
export function shelfWorkId(books: Map<number, ShelfBook>, bookId: number) {
  return books.get(bookId)?.workId ?? hardcoverWorkId(bookId)
}
