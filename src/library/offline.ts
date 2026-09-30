import { Directory, File, Paths } from 'expo-file-system'
import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { stopIfAborted } from '@/lib/abort'
import { database } from './database'
import { NotStreamableError } from './errors'
import { invalidateLibrary } from './invalidation'
import { type BookRecord, workIdOf } from './model'
import { getBook } from './repository'
import { streamUrl } from './streams'

/**
 * Books kept on the phone, so they play without a connection. Each file of the stream is
 * downloaded in turn into the app's own storage; the player prefers a finished copy over
 * streaming. Progress lives in memory while a download runs and in `offline_books` for good.
 */

export const offlineStatuses = ['downloading', 'done', 'failed'] as const

export type OfflineStatus = (typeof offlineStatuses)[number]

export type OfflineBook = {
  bookId: string
  status: OfflineStatus
  bytes: number
  total: number
}

const rowSchema = z.object({
  book_id: z.string(),
  status: z.enum(offlineStatuses),
  bytes: z.number(),
  total: z.number(),
})

function root() {
  return new Directory(Paths.document, 'offline')
}

function bookDirectory(bookId: string) {
  return new Directory(root(), encodeURIComponent(bookId))
}

function trackFile(bookId: string, index: number, format: string) {
  return new File(bookDirectory(bookId), `${index}.${format}`)
}

// Everything known, by book: the table read once at start, kept current by every change here.
let books = new Map<string, OfflineBook>(
  database
    .getAllSync<unknown>('SELECT book_id, status, bytes, total FROM offline_books')
    .flatMap((row) => {
      const parsed = rowSchema.safeParse(row)

      return parsed.success
        ? [
            [
              parsed.data.book_id,
              {
                bookId: parsed.data.book_id,
                status: parsed.data.status,
                bytes: parsed.data.bytes,
                total: parsed.data.total,
              },
            ] as const,
          ]
        : []
    }),
)

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function set(book: OfflineBook | null, bookId: string) {
  const next = new Map(books)

  if (book) {
    next.set(bookId, book)
  } else {
    next.delete(bookId)
  }

  books = next

  for (const listener of listeners) {
    listener()
  }
}

async function save(book: OfflineBook) {
  set(book, book.bookId)
  await database.runAsync(
    `INSERT INTO offline_books (book_id, status, bytes, total, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (book_id) DO UPDATE SET status = excluded.status, bytes = excluded.bytes,
     total = excluded.total, updated_at = excluded.updated_at`,
    book.bookId,
    book.status,
    book.bytes,
    book.total,
    Date.now(),
  )
}

/** Every book kept on the phone or on its way there, by stream. */
export function useOfflineBooks() {
  return useSyncExternalStore(subscribe, () => books)
}

export function offlineBook(bookId: string) {
  return books.get(bookId) ?? null
}

/** The local copy of one file of a book kept on the phone, or null to stream it. */
export function offlineTrackUri(book: BookRecord, index: number) {
  const track = book.tracks?.[index]

  if (!track || books.get(book.id)?.status !== 'done') {
    return null
  }

  const file = trackFile(book.id, index, track.format)

  return file.exists ? file.uri : null
}

/** Downloads running now, so each can be stopped. */
const running = new Map<string, AbortController>()

/**
 * Downloads every file of the stream that is not on the phone yet, one after another. The book
 * must be playable on TorBox already. Stopping it keeps what has finished, for the next attempt.
 */
export async function keepOffline(bookId: string) {
  if (running.has(bookId)) {
    return
  }

  const book = await getBook(bookId)
  const tracks = book?.tracks

  if (!book || !tracks || book.torrentId === null) {
    const earlier = offlineBook(bookId)

    // A download the app was closed during, whose book can no longer stream, has failed.
    if (earlier && earlier.status !== 'done') {
      await save({ ...earlier, status: 'failed' })
    }

    throw new NotStreamableError()
  }

  const torrentId = book.torrentId
  const total = tracks.reduce((sum, track) => sum + track.size, 0)
  const controller = new AbortController()

  running.set(bookId, controller)

  // Removing the book stops the download; nothing is saved after that, so no record comes back.
  const record = async (entry: OfflineBook) => {
    stopIfAborted(controller.signal)
    await save(entry)
  }

  try {
    const directory = bookDirectory(bookId)

    directory.create({ intermediates: true, idempotent: true })

    let done = 0

    await record({ bookId, status: 'downloading', bytes: 0, total })

    for (const [index, track] of tracks.entries()) {
      const file = trackFile(bookId, index, track.format)

      // A file finished on an earlier attempt is kept.
      if (file.exists && file.size === track.size) {
        done += track.size
        continue
      }

      let lastUpdate = 0
      const link = await streamUrl(torrentId, track.fileId, true)

      stopIfAborted(controller.signal)

      await File.downloadFileAsync(link.url, file, {
        idempotent: true,
        signal: controller.signal,
        onProgress: ({ bytesWritten }) => {
          const now = Date.now()

          // Twice a second is enough for a progress label.
          if (!controller.signal.aborted && now - lastUpdate > 500) {
            lastUpdate = now
            set({ bookId, status: 'downloading', bytes: done + bytesWritten, total }, bookId)
          }
        },
      })

      done += track.size
      await record({ bookId, status: 'downloading', bytes: done, total })
    }

    await record({ bookId, status: 'done', bytes: total, total })
    invalidateLibrary()
  } catch (error) {
    if (controller.signal.aborted) {
      return
    }

    await save({ bookId, status: 'failed', bytes: offlineBook(bookId)?.bytes ?? 0, total })

    throw error
  } finally {
    // A download started again after this one was stopped keeps its own entry.
    if (running.get(bookId) === controller) {
      running.delete(bookId)
    }
  }
}

/** Stops any download of the book and deletes its files from the phone. */
export async function removeOffline(bookId: string) {
  running.get(bookId)?.abort()
  running.delete(bookId)

  const directory = bookDirectory(bookId)

  if (directory.exists) {
    directory.delete()
  }

  set(null, bookId)
  await database.runAsync('DELETE FROM offline_books WHERE book_id = ?', bookId)
  invalidateLibrary()
}

/** Removes the phone copies of every stream of a book, such as when it leaves the library. */
export async function removeOfflineForWork(workId: string) {
  for (const bookId of books.keys()) {
    const book = await getBook(bookId)

    if (!book || workIdOf(book) === workId) {
      await removeOffline(bookId)
    }
  }
}

/** Bytes the books kept on the phone take. */
export function offlineBytes(all: Map<string, OfflineBook>) {
  let bytes = 0

  for (const book of all.values()) {
    bytes += book.status === 'done' ? book.total : book.bytes
  }

  return bytes
}

/**
 * Carries on downloads the app was closed during, one book after another rather than all at
 * once; call once at start.
 */
export function resumeOfflineDownloads() {
  const waiting = [...books.values()].filter((book) => book.status === 'downloading')

  void (async () => {
    for (const book of waiting) {
      await keepOffline(book.bookId).catch(() => undefined)
    }
  })()
}
