import { Directory, File } from 'expo-file-system'
import { z } from 'zod'
import { getAbbProxy, setAbbProxy } from '@/settings/abb-proxy'
import { annasKey } from '@/settings/annas-key'
import { hardcoverKey } from '@/settings/hardcover-key'
import { getPreferences, setPreference } from '@/settings/preferences'
import { torBoxKey } from '@/settings/torbox-key'
import { database } from './database'
import { hasEbookFile, reloadEbooks } from './ebooks'
import { isLanguage } from './languages'

/**
 * A backup of what the listener has made in the app: the library, progress, bookmarks, followed
 * series, e-books with their places, highlights and notes, and listening and reading
 * preferences, in one JSON file they keep where they like. API keys and the proxy sign-in are
 * written only when the listener asks for them, in plain text; caches and the e-book files
 * themselves never are.
 */

const backupVersion = 1

const bookRow = z.object({
  id: z.string(),
  abb: z.string(),
  abb_fetched_at: z.number(),
  hardcover_id: z.number().nullable(),
  hardcover: z.string().nullable(),
  match_state: z.string(),
  torrent_id: z.number().nullable(),
  tracks: z.string().nullable(),
  durations: z.string().nullable(),
  chapters: z.string().nullable(),
  last_played_at: z.number().nullable(),
})

const workRow = z.object({
  id: z.string(),
  hardcover_id: z.number().nullable(),
  work: z.string().nullable(),
  stream_id: z.string().nullable(),
  in_library: z.number(),
  added_at: z.number().nullable(),
  last_played_at: z.number().nullable(),
  finished_at: z.number().nullable(),
})

const playbackRow = z.object({
  book_id: z.string(),
  track: z.number(),
  position: z.number(),
  speed: z.number(),
  finished: z.number(),
  updated_at: z.number(),
})

const bookmarkRow = z.object({
  book_id: z.string(),
  track: z.number(),
  position: z.number(),
  note: z.string().nullable(),
  created_at: z.number(),
})

const seriesRow = z.object({
  id: z.number(),
  name: z.string(),
  known_books: z.string(),
  added_at: z.number(),
})

const ebookRow = z.object({
  md5: z.string(),
  source: z.enum(['annas', 'libgen']),
  title: z.string(),
  authors: z.string(),
  publisher: z.string().nullable(),
  year: z.string().nullable(),
  language: z.string().nullable(),
  size: z.string().nullable(),
  cover_url: z.string().nullable(),
  work_id: z.string().nullable(),
  location: z.string().nullable(),
  progress: z.number(),
  chapter: z.string().nullable(),
  added_at: z.number(),
  last_read_at: z.number().nullable(),
  // Added after the first backups with e-books.
  chosen_at: z.number().nullable().default(null),
})

const ebookMarkRow = z.object({
  md5: z.string(),
  kind: z.enum(['highlight', 'bookmark']),
  location: z.string(),
  text: z.string().nullable(),
  note: z.string().nullable(),
  color: z.string().nullable(),
  created_at: z.number(),
})

/** The keys and the proxy sign-in, when the listener chose to include them. */
const secretsSchema = z
  .object({
    torBox: z.string().min(1),
    hardcover: z.string().min(1),
    annas: z.string().min(1),
    proxy: z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  })
  .partial()

const backupSchema = z.object({
  app: z.literal('vaka'),
  version: z.number().int().max(backupVersion),
  exportedAt: z.number(),
  books: z.array(bookRow),
  works: z.array(workRow),
  playback: z.array(playbackRow),
  bookmarks: z.array(bookmarkRow),
  series: z.array(seriesRow),
  // Added after the first backups, which have none.
  ebooks: z.array(ebookRow).default([]),
  ebookMarks: z.array(ebookMarkRow).default([]),
  secrets: secretsSchema.optional(),
  preferences: z
    .object({
      skipBackSeconds: z.number(),
      skipForwardSeconds: z.number(),
      defaultSpeed: z.number(),
      abbBaseUrl: z.string(),
      readerFontSize: z.number(),
      readerLineHeight: z.number(),
      readerFont: z.enum(['publisher', 'serif', 'sans']),
      // A theme no longer offered is left out rather than failing the whole restore.
      readerTheme: z.enum(['auto', 'light', 'dark']).optional().catch(undefined),
      readerMargin: z.number(),
      readerJustify: z.boolean(),
      preferredLanguage: z.string(),
    })
    .partial(),
})

export type Backup = z.infer<typeof backupSchema>

/** What a backup holds, to show before it is restored. */
export type BackupContents = {
  books: number
  bookmarks: number
  ebooks: number
  notes: number
  series: number
  settings: boolean
  secrets: boolean
}

/** What a restore brought in. */
export type RestoreSummary = { books: number; bookmarks: number; ebooks: number }

/** Whether any key or the proxy sign-in is on the phone, to ask about including them. */
export function hasSecrets() {
  return Boolean(torBoxKey.get() || hardcoverKey.get() || annasKey.get() || getAbbProxy())
}

function secrets() {
  const proxy = getAbbProxy()

  return {
    torBox: torBoxKey.get() ?? undefined,
    hardcover: hardcoverKey.get() ?? undefined,
    annas: annasKey.get() ?? undefined,
    proxy: proxy ?? undefined,
  }
}

async function rows<T extends z.ZodType>(sql: string, schema: T): Promise<z.infer<T>[]> {
  const found = await database.getAllAsync<unknown>(sql)

  return found.flatMap((row) => {
    const parsed = schema.safeParse(row)

    return parsed.success ? [parsed.data] : []
  })
}

/** Everything the backup keeps, read from the database; the keys only with `withSecrets`. */
async function collect(withSecrets: boolean): Promise<Backup> {
  // Books in the library or ever played, with the uploads they use or have progress in.
  const works = await rows(
    `SELECT id, hardcover_id, work, stream_id, in_library, added_at, last_played_at, finished_at
     FROM works WHERE in_library = 1 OR last_played_at IS NOT NULL`,
    workRow,
  )

  const books = await rows(
    `SELECT id, abb, abb_fetched_at, hardcover_id, hardcover, match_state, torrent_id, tracks,
     durations, chapters, last_played_at FROM books
     WHERE id IN (SELECT stream_id FROM works WHERE in_library = 1 OR last_played_at IS NOT NULL)
       OR id IN (SELECT book_id FROM playback) OR id IN (SELECT book_id FROM bookmarks)`,
    bookRow,
  )

  const preferences = getPreferences()

  return {
    app: 'vaka',
    version: backupVersion,
    exportedAt: Date.now(),
    books,
    works,
    playback: await rows('SELECT * FROM playback', playbackRow),
    bookmarks: await rows(
      'SELECT book_id, track, position, note, created_at FROM bookmarks',
      bookmarkRow,
    ),
    series: await rows('SELECT id, name, known_books, added_at FROM series', seriesRow),
    ebooks: await rows(
      `SELECT md5, source, title, authors, publisher, year, language, size, cover_url, work_id,
       location, progress, chapter, added_at, last_read_at, chosen_at FROM ebooks`,
      ebookRow,
    ),
    ebookMarks: await rows(
      'SELECT md5, kind, location, text, note, color, created_at FROM ebook_marks',
      ebookMarkRow,
    ),
    secrets: withSecrets ? secrets() : undefined,
    preferences: {
      skipBackSeconds: preferences.skipBackSeconds,
      skipForwardSeconds: preferences.skipForwardSeconds,
      defaultSpeed: preferences.defaultSpeed,
      abbBaseUrl: preferences.abbBaseUrl,
      readerFontSize: preferences.readerFontSize,
      readerLineHeight: preferences.readerLineHeight,
      readerFont: preferences.readerFont,
      readerTheme: preferences.readerTheme,
      readerMargin: preferences.readerMargin,
      readerJustify: preferences.readerJustify,
      preferredLanguage: preferences.preferredLanguage,
    },
  }
}

/**
 * Writes a backup into a folder the listener picks, with the keys and proxy sign-in when
 * `withSecrets`. Resolves with the file's name, or null when they close the picker.
 */
export async function exportBackup(withSecrets: boolean): Promise<string | null> {
  let folder: Directory

  try {
    folder = await Directory.pickDirectoryAsync()
  } catch {
    // Closing the picker rejects; nothing was asked to be saved.
    return null
  }

  const backup = await collect(withSecrets)
  const day = new Date(backup.exportedAt).toISOString().slice(0, 10)
  const name = `vaka-backup-${day}.json`
  const file = folder.createFile(name, 'application/json')

  file.write(JSON.stringify(backup))

  return name
}

export class BackupFormatError extends Error {
  constructor() {
    super('This file is not a Vaka backup')
    this.name = 'BackupFormatError'
  }
}

/**
 * Reads a backup the listener picks, and what it holds, without changing anything yet. Resolves
 * with null when they close the picker.
 */
export async function pickBackup(): Promise<{ backup: Backup; contents: BackupContents } | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', '*/*'] })

  if (picked.canceled) {
    return null
  }

  let backup: Backup

  try {
    backup = backupSchema.parse(JSON.parse(await picked.result.text()))
  } catch {
    throw new BackupFormatError()
  }

  const kept = backup.secrets ?? {}

  return {
    backup,
    contents: {
      books: backup.works.filter((work) => work.in_library === 1).length,
      bookmarks: backup.bookmarks.length,
      ebooks: backup.ebooks.length,
      notes: backup.ebookMarks.length,
      series: backup.series.length,
      settings: Object.values(backup.preferences).some((value) => value !== undefined),
      secrets: Boolean(kept.torBox || kept.hardcover || kept.annas || kept.proxy),
    },
  }
}

/**
 * Adds a backup to what is on the phone. Nothing is removed or overwritten with older data: books
 * join the library, progress is kept wherever it is further along in time, bookmarks already here
 * are not doubled, and keys fill in only those the phone does not have.
 */
export async function restoreBackup(backup: Backup): Promise<RestoreSummary> {
  let bookmarks = 0
  let ebooks = 0

  await database.withExclusiveTransactionAsync(async (txn) => {
    for (const book of backup.books) {
      await txn.runAsync(
        `INSERT INTO books (id, abb, abb_fetched_at, hardcover_id, hardcover, match_state,
         torrent_id, tracks, durations, chapters, last_played_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           last_played_at = CASE
             WHEN books.last_played_at IS NULL THEN excluded.last_played_at
             WHEN excluded.last_played_at IS NULL THEN books.last_played_at
             ELSE max(books.last_played_at, excluded.last_played_at)
           END`,
        book.id,
        book.abb,
        book.abb_fetched_at,
        book.hardcover_id,
        book.hardcover,
        book.match_state,
        book.torrent_id,
        book.tracks,
        book.durations,
        book.chapters,
        book.last_played_at,
        Date.now(),
      )
    }

    for (const work of backup.works) {
      await txn.runAsync(
        `INSERT INTO works (id, hardcover_id, work, stream_id, in_library, added_at,
         last_played_at, finished_at, updated_at)
         VALUES (?, ?, ?, (SELECT id FROM books WHERE id = ?), ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           work = coalesce(works.work, excluded.work),
           stream_id = coalesce(works.stream_id, excluded.stream_id),
           in_library = max(works.in_library, excluded.in_library),
           added_at = coalesce(works.added_at, excluded.added_at),
           last_played_at = CASE WHEN excluded.last_played_at > coalesce(works.last_played_at, 0)
             THEN excluded.last_played_at ELSE works.last_played_at END,
           finished_at = CASE
             WHEN coalesce(excluded.last_played_at, 0) > coalesce(works.last_played_at, 0)
               THEN excluded.finished_at
             WHEN coalesce(works.last_played_at, 0) > coalesce(excluded.last_played_at, 0)
               THEN works.finished_at
             ELSE coalesce(works.finished_at, excluded.finished_at) END`,
        work.id,
        work.hardcover_id,
        work.work,
        work.stream_id,
        work.in_library,
        work.added_at,
        work.last_played_at,
        work.finished_at,
        Date.now(),
      )
    }

    for (const playback of backup.playback) {
      await txn.runAsync(
        `INSERT INTO playback (book_id, track, position, speed, finished, updated_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM books WHERE id = ?)
         ON CONFLICT (book_id) DO UPDATE SET track = excluded.track, position = excluded.position,
           speed = excluded.speed, finished = excluded.finished, updated_at = excluded.updated_at
         WHERE excluded.updated_at > playback.updated_at`,
        playback.book_id,
        playback.track,
        playback.position,
        playback.speed,
        playback.finished,
        playback.updated_at,
        playback.book_id,
      )
    }

    for (const bookmark of backup.bookmarks) {
      const result = await txn.runAsync(
        `INSERT INTO bookmarks (book_id, track, position, note, created_at)
         SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM books WHERE id = ?)
           AND NOT EXISTS (SELECT 1 FROM bookmarks WHERE book_id = ? AND track = ?
             AND abs(position - ?) < 1)`,
        bookmark.book_id,
        bookmark.track,
        bookmark.position,
        bookmark.note,
        bookmark.created_at,
        bookmark.book_id,
        bookmark.book_id,
        bookmark.track,
        bookmark.position,
      )

      bookmarks += result.changes
    }

    // E-books come back with their places; their files are fetched again when read, unless the
    // file is still here. A place further along in time is kept.
    for (const ebook of backup.ebooks) {
      const result = await txn.runAsync(
        `INSERT INTO ebooks (md5, source, title, authors, publisher, year, language, size,
         cover_url, work_id, status, bytes, total, location, progress, chapter, added_at,
         last_read_at, chosen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (md5) DO UPDATE SET location = excluded.location,
           progress = excluded.progress, chapter = excluded.chapter,
           last_read_at = excluded.last_read_at, work_id = coalesce(ebooks.work_id, excluded.work_id)
         WHERE coalesce(excluded.last_read_at, 0) > coalesce(ebooks.last_read_at, 0)`,
        ebook.md5,
        ebook.source,
        ebook.title,
        ebook.authors,
        ebook.publisher,
        ebook.year,
        ebook.language,
        ebook.size,
        ebook.cover_url,
        ebook.work_id,
        hasEbookFile(ebook.md5) ? 'done' : 'remote',
        ebook.location,
        ebook.progress,
        ebook.chapter,
        ebook.added_at,
        ebook.last_read_at,
        ebook.chosen_at,
        Date.now(),
      )

      ebooks += result.changes
    }

    for (const mark of backup.ebookMarks) {
      await txn.runAsync(
        `INSERT INTO ebook_marks (md5, kind, location, text, note, color, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ebooks WHERE md5 = ?)
           AND NOT EXISTS (SELECT 1 FROM ebook_marks WHERE md5 = ? AND kind = ? AND location = ?)`,
        mark.md5,
        mark.kind,
        mark.location,
        mark.text,
        mark.note,
        mark.color,
        mark.created_at,
        mark.md5,
        mark.md5,
        mark.kind,
        mark.location,
      )
    }

    for (const series of backup.series) {
      await txn.runAsync(
        `INSERT INTO series (id, name, known_books, added_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        series.id,
        series.name,
        series.known_books,
        series.added_at,
        Date.now(),
      )
    }
  })

  reloadEbooks()

  const kept = backup.secrets

  if (kept?.torBox && !torBoxKey.get()) {
    await torBoxKey.set(kept.torBox)
  }

  if (kept?.hardcover && !hardcoverKey.get()) {
    await hardcoverKey.set(kept.hardcover)
  }

  if (kept?.annas && !annasKey.get()) {
    await annasKey.set(kept.annas)
  }

  if (kept?.proxy && !getAbbProxy()) {
    await setAbbProxy(kept.proxy)
  }

  const preferences = backup.preferences

  if (preferences.skipBackSeconds !== undefined) {
    await setPreference('skipBackSeconds', preferences.skipBackSeconds)
  }

  if (preferences.skipForwardSeconds !== undefined) {
    await setPreference('skipForwardSeconds', preferences.skipForwardSeconds)
  }

  if (preferences.defaultSpeed !== undefined) {
    await setPreference('defaultSpeed', preferences.defaultSpeed)
  }

  if (preferences.abbBaseUrl !== undefined) {
    await setPreference('abbBaseUrl', preferences.abbBaseUrl)
  }

  // A language this version does not offer is left as it is.
  if (preferences.preferredLanguage !== undefined && isLanguage(preferences.preferredLanguage)) {
    await setPreference('preferredLanguage', preferences.preferredLanguage)
  }

  const readerKeys = [
    'readerFontSize',
    'readerLineHeight',
    'readerFont',
    'readerTheme',
    'readerMargin',
    'readerJustify',
  ] as const

  for (const key of readerKeys) {
    const value = preferences[key]

    if (value !== undefined) {
      await setPreference(key, value)
    }
  }

  return {
    books: backup.works.filter((work) => work.in_library === 1).length,
    bookmarks,
    ebooks,
  }
}
