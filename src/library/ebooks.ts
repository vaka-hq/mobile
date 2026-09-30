import { Directory, File, FileMode, Paths } from 'expo-file-system'
import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { stopIfAborted } from '@/lib/abort'
import { annasKey } from '@/settings/annas-key'
import { getPreferences } from '@/settings/preferences'
import {
  AnnasKeyError,
  annasDownload,
  searchAnnas,
  signInToAnnas,
} from '@/sources/annas-archive/client'
import { libgenDownload, libgenHeaders, searchLibgen } from '@/sources/libgen/client'
import { readBookSections } from '../../modules/android-components'
import { database } from './database'
import { UnexpectedAnswerError } from './errors'

/**
 * E-books to read: found on Anna's Archive (with a member key) and Library Genesis, downloaded
 * into the app's storage, and remembered with where the reader is and what they marked.
 */

export const ebookSources = ['annas', 'libgen'] as const

export type EbookSource = (typeof ebookSources)[number]

/** One file found for a book, whichever site found it. Files are identified by their md5. */
export type EbookResult = {
  md5: string
  source: EbookSource
  title: string
  authors: string[]
  publisher: string | null
  year: string | null
  language: string | null
  extension: string | null
  size: string | null
  coverUrl: string | null
  isbns: string[]
}

/**
 * `remote` is a file known and chosen but not on the phone; `done` has a copy here, kept for
 * offline reading or only in the cache while it is read.
 */
export const ebookStatuses = ['remote', 'downloading', 'done', 'failed'] as const

export type EbookStatus = (typeof ebookStatuses)[number]

const ebookRow = z.object({
  md5: z.string(),
  source: z.enum(ebookSources),
  title: z.string(),
  authors: z.string(),
  publisher: z.string().nullable(),
  year: z.string().nullable(),
  language: z.string().nullable(),
  size: z.string().nullable(),
  cover_url: z.string().nullable(),
  work_id: z.string().nullable(),
  status: z.enum(ebookStatuses),
  bytes: z.number(),
  total: z.number(),
  location: z.string().nullable(),
  progress: z.number(),
  chapter: z.string().nullable(),
  added_at: z.number(),
  last_read_at: z.number().nullable(),
  chosen_at: z.number().nullable(),
  sections: z.string().nullish(),
  passage: z.string().nullish(),
  page: z.number().nullish(),
  pages: z.number().nullish(),
})

/** A part of an e-book as its contents list it, and where it starts, from 0 to 1. */
export const ebookSection = z.object({ label: z.string(), fraction: z.number() })

export type EbookSection = z.infer<typeof ebookSection>

/** An e-book file known to the app: chosen, read, on its way to the phone or kept there. */
export type Ebook = {
  md5: string
  source: EbookSource
  title: string
  authors: string[]
  publisher: string | null
  year: string | null
  language: string | null
  size: string | null
  coverUrl: string | null
  /** The Hardcover book it was found for, when it was. */
  workId: string | null
  status: EbookStatus
  /**
   * Kept on the phone to read offline, until the listener deletes it; otherwise a copy being read
   * lives in the cache, which clearing it or Android may empty.
   */
  kept: boolean
  bytes: number
  total: number
  /** Where the reader stopped, as the reader writes places. */
  location: string | null
  /** How far through the book, from 0 to 1. */
  progress: number
  chapter: string | null
  addedAt: number
  lastReadAt: number | null
  /** When it was chosen to read the book it was found for; the latest choice is the one read. */
  chosenAt: number | null
  /** Its contents with where each part starts, learned when it is first opened. */
  sections: EbookSection[] | null
  /** The words at the top of the page where reading stopped, to find the place in the audio. */
  passage: string | null
  /** The page reading stopped on, and how many there are, as the reader counted them. */
  page: number | null
  pages: number | null
}

function toEbook(data: z.infer<typeof ebookRow>): Ebook {
  let authors: string[] = []

  try {
    authors = z.array(z.string()).catch([]).parse(JSON.parse(data.authors))
  } catch {
    authors = []
  }

  let sections: EbookSection[] | null = null

  try {
    sections = data.sections ? z.array(ebookSection).parse(JSON.parse(data.sections)) : null
  } catch {
    sections = null
  }

  return {
    md5: data.md5,
    source: data.source,
    title: data.title,
    authors,
    publisher: data.publisher,
    year: data.year,
    language: data.language,
    size: data.size,
    coverUrl: data.cover_url,
    workId: data.work_id,
    status: data.status,
    kept: false,
    bytes: data.bytes,
    total: data.total,
    location: data.location,
    progress: data.progress,
    chapter: data.chapter,
    addedAt: data.added_at,
    lastReadAt: data.last_read_at,
    chosenAt: data.chosen_at,
    sections,
    passage: data.passage ?? null,
    page: data.page ?? null,
    pages: data.pages ?? null,
  }
}

// Kept files live with the app's documents; copies fetched only to read live in the cache.
function keptDirectory() {
  return new Directory(Paths.document, 'ebooks')
}

function cacheDirectory() {
  return new Directory(Paths.cache, 'ebooks')
}

function keptFile(md5: string) {
  return new File(keptDirectory(), `${md5}.epub`)
}

function cachedFile(md5: string) {
  return new File(cacheDirectory(), `${md5}.epub`)
}

/** The local file of an e-book on the phone, kept or cached, for the reader to open. */
export function ebookUri(md5: string) {
  const kept = keptFile(md5)

  return (kept.exists ? kept : cachedFile(md5)).uri
}

/** Whether an e-book's file is on the phone, kept or cached. */
export function hasEbookFile(md5: string) {
  return keptFile(md5).exists || cachedFile(md5).exists
}

/**
 * An e-book as its files show it now: the cache can be emptied behind the app's back, and a
 * download the app was closed during never finished.
 */
function withFiles(ebook: Ebook): Ebook {
  if (running.has(ebook.md5)) {
    return ebook
  }

  const kept = keptFile(ebook.md5).exists
  const onPhone = kept || cachedFile(ebook.md5).exists

  return {
    ...ebook,
    kept,
    status: onPhone ? 'done' : ebook.status === 'failed' ? 'failed' : 'remote',
  }
}

function readAll() {
  return new Map<string, Ebook>(
    database.getAllSync<unknown>('SELECT * FROM ebooks').flatMap((row) => {
      const parsed = ebookRow.safeParse(row)

      return parsed.success ? [[parsed.data.md5, withFiles(toEbook(parsed.data))] as const] : []
    }),
  )
}

/** Downloads running now, so each can be stopped. */
const running = new Map<string, AbortController>()

/** Deletes what downloads cut short by the app closing left behind. */
function removePartialFiles() {
  for (const directory of [keptDirectory(), cacheDirectory()]) {
    if (directory.exists) {
      for (const entry of directory.list()) {
        if (entry instanceof File && entry.name.endsWith('.part')) {
          entry.delete()
        }
      }
    }
  }
}

/**
 * Moves e-books fetched into the cache to read, before every download was kept, to stay on the
 * phone with the rest, so a book once read counts as downloaded.
 */
async function keepCachedFiles() {
  const cache = cacheDirectory()

  if (!cache.exists) {
    return
  }

  let moved = false

  for (const entry of cache.list()) {
    if (entry instanceof File && entry.name.endsWith('.epub')) {
      const kept = new File(keptDirectory(), entry.name)

      if (kept.exists) {
        entry.delete()
      } else {
        keptDirectory().create({ intermediates: true, idempotent: true })
        await entry.move(kept)
        moved = true
      }
    }
  }

  // The books were read in before the files moved, so they are read again to say so.
  if (moved) {
    reloadEbooks()
  }
}

removePartialFiles()

void keepCachedFiles().catch(() => undefined)

// Every e-book, read once at start and kept current by every change here, so progress labels
// update while a download runs.
let ebooks = readAll()

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function publish(md5: string, ebook: Ebook | null) {
  const next = new Map(ebooks)

  if (ebook) {
    next.set(md5, ebook)
  } else {
    next.delete(md5)
  }

  ebooks = next

  for (const listener of listeners) {
    listener()
  }
}

/** Reads every e-book again after the database changed underneath, such as by a restore. */
export function reloadEbooks() {
  ebooks = readAll()

  for (const listener of listeners) {
    listener()
  }
}

/** What a kept e-book was found as, to download it again. */
export function ebookResultOf(ebook: Ebook): EbookResult {
  return { ...ebook, extension: 'epub', isbns: [] }
}

/** Every e-book on the phone or on its way there, by md5. */
export function useEbooks() {
  return useSyncExternalStore(subscribe, () => ebooks)
}

/**
 * The e-book a book is read in: the one chosen for it last, else the one read last. Null when none
 * was found for it yet.
 */
export function ebookOfWork(all: Map<string, Ebook>, workId: string) {
  return (
    [...all.values()]
      .filter((ebook) => ebook.workId === workId)
      .sort(
        (a, b) =>
          (b.chosenAt ?? 0) - (a.chosenAt ?? 0) || (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0),
      )[0] ?? null
  )
}

/** Every e-book known, for finding one by what it belongs to. */
export function listEbooks() {
  return [...ebooks.values()]
}

export function getEbook(md5: string) {
  return ebooks.get(md5) ?? null
}

/** Whether an e-book can be opened now: its file is on the phone. */
export function readyToRead(md5: string) {
  return getEbook(md5)?.status === 'done' && hasEbookFile(md5)
}

async function save(ebook: Ebook) {
  publish(ebook.md5, ebook)
  await database.runAsync(
    `INSERT INTO ebooks (md5, source, title, authors, publisher, year, language, size, cover_url,
     work_id, status, bytes, total, location, progress, chapter, added_at, last_read_at, chosen_at,
     updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (md5) DO UPDATE SET source = excluded.source, title = excluded.title,
     authors = excluded.authors, publisher = excluded.publisher, year = excluded.year,
     language = excluded.language, size = excluded.size, cover_url = excluded.cover_url,
     work_id = coalesce(excluded.work_id, ebooks.work_id), status = excluded.status,
     bytes = excluded.bytes, total = excluded.total, location = excluded.location,
     progress = excluded.progress, chapter = excluded.chapter,
     last_read_at = excluded.last_read_at, chosen_at = excluded.chosen_at,
     updated_at = excluded.updated_at`,
    ebook.md5,
    ebook.source,
    ebook.title,
    JSON.stringify(ebook.authors),
    ebook.publisher,
    ebook.year,
    ebook.language,
    ebook.size,
    ebook.coverUrl,
    ebook.workId,
    ebook.status,
    ebook.bytes,
    ebook.total,
    ebook.location,
    ebook.progress,
    ebook.chapter,
    ebook.addedAt,
    ebook.lastReadAt,
    ebook.chosenAt,
    Date.now(),
  )
}

/** A cover for a file without one, from Open Library by ISBN; it fails quietly when missing. */
function coverByIsbn(isbns: string[]) {
  const isbn = isbns.find((value) => /^\d{13}$|^\d{9}[\dX]$/u.test(value))

  return isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : null
}

let annasSession: { baseUrl: string; key: string } | null = null

async function searchAnnasSignedIn(query: string, page: number, signal?: AbortSignal) {
  const key = annasKey.get()
  const baseUrl = getPreferences().annasBaseUrl

  if (!key) {
    return { files: [], hasNextPage: false }
  }

  // One sign-in per key and mirror; the phone's cookie store keeps the session.
  if (annasSession?.key !== key || annasSession.baseUrl !== baseUrl) {
    await signInToAnnas(baseUrl, key, signal)
    annasSession = { baseUrl, key }
  }

  let found: Awaited<ReturnType<typeof searchAnnas>>

  try {
    found = await searchAnnas(baseUrl, query, page, signal)
  } catch (error) {
    // The session may have ended; the next search signs in again.
    annasSession = null
    throw error
  }

  return {
    files: found.files.map((file): EbookResult => ({ ...file, source: 'annas', isbns: [] })),
    hasNextPage: found.hasNextPage,
  }
}

/** Where an e-book search has got to: the page to ask for next, and which sites have more. */
export type EbookSearchPlace = { page: number; sites: EbookSource[] }

/** One page of e-books found by a search, and where the next page, if any, starts. */
export type EbookSearchPage = { items: EbookResult[]; next: EbookSearchPlace | null }

export const firstEbookPage: EbookSearchPlace = { page: 1, sites: [...ebookSources] }

/**
 * EPUBs matching `query`: Anna's Archive first when there is a member key, then Library Genesis,
 * one entry per file. Either site failing leaves the other's results; both failing is an error.
 */
export async function searchEbooks(query: string, signal?: AbortSignal): Promise<EbookResult[]> {
  return (await searchEbooksPage(query, firstEbookPage, signal)).items
}

/**
 * A page of `searchEbooks`, asking only the sites that had more last time. A site that fails on a
 * later page is left out of the pages after it, and the other carries on.
 */
export async function searchEbooksPage(
  query: string,
  place: EbookSearchPlace,
  signal?: AbortSignal,
): Promise<EbookSearchPage> {
  const none = Promise.resolve({ files: [], hasNextPage: false })

  const [annas, libgen] = await Promise.allSettled([
    place.sites.includes('annas') ? searchAnnasSignedIn(query, place.page, signal) : none,
    place.sites.includes('libgen')
      ? searchLibgen(getPreferences().libgenBaseUrl, query, place.page, signal).then(
          ({ files, hasNextPage }) => ({
            files: files.map((file): EbookResult => ({
              ...file,
              source: 'libgen',
              coverUrl: coverByIsbn(file.isbns),
            })),
            hasNextPage,
          }),
        )
      : none,
  ])

  if (annas.status === 'rejected' && libgen.status === 'rejected') {
    throw libgen.reason instanceof Error ? libgen.reason : new Error(String(libgen.reason))
  }

  const seen = new Map<string, EbookResult>()

  for (const result of [
    ...(annas.status === 'fulfilled' ? annas.value.files : []),
    ...(libgen.status === 'fulfilled' ? libgen.value.files : []),
  ]) {
    const existing = seen.get(result.md5)

    // The same file on both sites keeps Anna's details and gains Library Genesis' ISBNs.
    seen.set(
      result.md5,
      existing
        ? { ...existing, isbns: existing.isbns.length ? existing.isbns : result.isbns }
        : result,
    )
  }

  const sites: EbookSource[] = [
    ...(annas.status === 'fulfilled' && annas.value.hasNextPage ? ['annas' as const] : []),
    ...(libgen.status === 'fulfilled' && libgen.value.hasNextPage ? ['libgen' as const] : []),
  ]

  return {
    items: [...seen.values()].filter((result) => result.extension === 'epub'),
    next: sites.length > 0 ? { page: place.page + 1, sites } : null,
  }
}

async function downloadLink(md5: string, signal: AbortSignal) {
  const key = annasKey.get()
  const { annasBaseUrl, libgenBaseUrl } = getPreferences()

  if (key) {
    try {
      return { url: (await annasDownload(annasBaseUrl, key, md5, signal)).url, headers: {} }
    } catch (error) {
      // A rejected key is the listener's to fix; anything else falls back to Library Genesis.
      if (error instanceof AnnasKeyError) {
        throw error
      }
    }
  }

  const link = await libgenDownload(libgenBaseUrl, md5, signal)

  return { url: link.url, coverUrl: link.coverUrl, headers: libgenHeaders(libgenBaseUrl) }
}

function recordOf(result: EbookResult, previous: Ebook | null, workId: string | null): Ebook {
  return {
    md5: result.md5,
    source: result.source,
    title: result.title,
    authors: result.authors,
    publisher: result.publisher,
    year: result.year,
    language: result.language,
    size: result.size,
    coverUrl: result.coverUrl ?? previous?.coverUrl ?? null,
    workId: workId ?? previous?.workId ?? null,
    status: previous?.status ?? 'remote',
    kept: previous?.kept ?? false,
    bytes: previous?.bytes ?? 0,
    total: previous?.total ?? 0,
    location: previous?.location ?? null,
    progress: previous?.progress ?? 0,
    chapter: previous?.chapter ?? null,
    addedAt: previous?.addedAt ?? Date.now(),
    lastReadAt: previous?.lastReadAt ?? null,
    chosenAt: previous?.chosenAt ?? null,
    sections: previous?.sections ?? null,
    passage: previous?.passage ?? null,
    page: previous?.page ?? null,
    pages: previous?.pages ?? null,
  }
}

/** Whether a file starts like a zip, as every EPUB does, rather than an error page. */
function isZip(file: File) {
  const handle = file.open(FileMode.ReadOnly)

  try {
    const head = handle.readBytes(2)

    return head[0] === 0x50 && head[1] === 0x4b
  } finally {
    handle.close()
  }
}

/** Moves a copy fetched into the cache to read, before files were kept, to stay on the phone. */
async function keepCachedFile(md5: string) {
  const cached = cachedFile(md5)

  if (cached.exists && !keptFile(md5).exists) {
    keptDirectory().create({ intermediates: true, idempotent: true })
    await cached.move(keptFile(md5))
  }
}

/**
 * The record a download started from, with what changed while it ran: the book it was chosen
 * for, and where it was read to, which a reset of the book's progress may have cleared.
 */
function latest(base: Ebook): Ebook {
  const now = getEbook(base.md5)

  return now
    ? {
        ...base,
        workId: now.workId,
        chosenAt: now.chosenAt,
        location: now.location,
        progress: now.progress,
        chapter: now.chapter,
        lastReadAt: now.lastReadAt,
        passage: now.passage,
        page: now.page,
        pages: now.pages,
      }
    : base
}

/**
 * Brings a file onto the phone to stay, whether to read it now or offline later; a copy fetched
 * into the cache to read before files were kept is moved to stay. Anna's Archive's fast link is
 * used with a member key, else Library Genesis. Found for a book, the file becomes the one it is
 * read in.
 */
export async function downloadEbook(result: EbookResult, workId: string | null) {
  const previous = getEbook(result.md5)
  const now = Date.now()

  if (running.has(result.md5)) {
    return
  }

  if (previous && readyToRead(result.md5)) {
    await keepCachedFile(result.md5)

    await save(
      withFiles({
        ...previous,
        workId: workId ?? previous.workId,
        chosenAt: workId ? now : previous.chosenAt,
      }),
    )

    return
  }

  const controller = new AbortController()
  const target = keptFile(result.md5)
  // Written beside the target and moved into place whole, so a stopped or failed download never
  // leaves part of a book where a finished one is looked for.
  const partialUri = `${target.uri}.${now}.part`
  const partial = new File(partialUri)

  running.set(result.md5, controller)

  const base: Ebook = {
    ...recordOf(result, previous, workId),
    status: 'downloading',
    bytes: 0,
    total: 0,
    chosenAt: workId ? now : (previous?.chosenAt ?? null),
  }

  try {
    await save(base)
    keptDirectory().create({ intermediates: true, idempotent: true })

    const link = await downloadLink(result.md5, controller.signal)
    const coverUrl = base.coverUrl ?? ('coverUrl' in link ? (link.coverUrl ?? null) : null)
    let lastUpdate = 0

    await File.downloadFileAsync(link.url, partial, {
      idempotent: true,
      headers: link.headers,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const time = Date.now()

        if (!controller.signal.aborted && time - lastUpdate > 400) {
          lastUpdate = time
          publish(result.md5, {
            ...base,
            coverUrl,
            bytes: bytesWritten,
            total: Math.max(totalBytes, 0),
          })
        }
      },
    })

    stopIfAborted(controller.signal)

    if (!isZip(partial)) {
      throw new UnexpectedAnswerError('The downloaded file is not an EPUB')
    }

    await partial.move(target, { overwrite: true })

    const size = target.size

    running.delete(result.md5)

    await save(withFiles({ ...latest(base), coverUrl, status: 'done', bytes: size, total: size }))
    // Its contents are read now, so a place heard in its audiobook can be found before it opens.
    void learnSections(result.md5)
  } catch (error) {
    if (controller.signal.aborted) {
      return
    }

    await save({ ...latest(base), status: 'failed' })

    throw error
  } finally {
    // A download started again after this one was stopped keeps its own entries.
    if (running.get(result.md5) === controller) {
      running.delete(result.md5)
    }

    // Moving a file points its object at the new place, so the partial one is looked up afresh;
    // otherwise the finished book would be deleted here.
    const leftover = new File(partialUri)

    if (leftover.exists) {
      leftover.delete()
    }
  }
}

/** Deletes an e-book's file from the phone, keeping the book's place, highlights and notes. */
export async function removeEbookFile(md5: string) {
  running.get(md5)?.abort()
  running.delete(md5)

  for (const file of [keptFile(md5), cachedFile(md5)]) {
    if (file.exists) {
      file.delete()
    }
  }

  const ebook = getEbook(md5)

  if (ebook) {
    await save({ ...ebook, status: 'remote', kept: false, bytes: 0, total: 0 })
  }
}

/**
 * Deletes an e-book's download with everything saved in it: its place, highlights, notes and
 * bookmarks. The book keeps it as the file it is read in, to download again.
 */
export async function deleteEbookDownload(md5: string) {
  await removeEbookFile(md5)

  const ebook = getEbook(md5)

  if (ebook) {
    publish(md5, {
      ...ebook,
      location: null,
      progress: 0,
      chapter: null,
      passage: null,
      page: null,
      pages: null,
      lastReadAt: null,
    })
  }

  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `UPDATE ebooks SET location = NULL, progress = 0, chapter = NULL, passage = NULL,
       page = NULL, pages = NULL, last_read_at = NULL, updated_at = ? WHERE md5 = ?`,
      Date.now(),
      md5,
    )
    await txn.runAsync('DELETE FROM ebook_marks WHERE md5 = ?', md5)
  })
}

/** Stops a download or deletes an e-book with its place and marks. */
export async function removeEbook(md5: string) {
  await removeEbookFile(md5)
  publish(md5, null)
  await database.runAsync('DELETE FROM ebooks WHERE md5 = ?', md5)
}

/** Bytes the copies fetched only to read take in the cache. */
export function ebookCacheBytes() {
  const directory = cacheDirectory()

  return directory.exists ? (directory.size ?? 0) : 0
}

/** Empties the cache of copies fetched only to read; kept files and every place stay. */
export async function clearEbookCache() {
  const directory = cacheDirectory()

  if (directory.exists) {
    directory.delete()
  }

  for (const ebook of ebooks.values()) {
    if (!running.has(ebook.md5)) {
      publish(ebook.md5, withFiles(ebook))
    }
  }
}

/** Remembers where the reader is; called as pages turn. */
export async function saveReadingPosition(
  md5: string,
  position: {
    location: string
    progress: number
    chapter: string | null
    passage: string | null
    page: number | null
    pages: number | null
  },
) {
  const ebook = getEbook(md5)

  if (!ebook) {
    return
  }

  const now = Date.now()

  publish(md5, { ...ebook, ...position, lastReadAt: now })
  await database.runAsync(
    `UPDATE ebooks SET location = ?, progress = ?, chapter = ?, passage = ?, page = ?, pages = ?,
     last_read_at = ?, updated_at = ? WHERE md5 = ?`,
    position.location,
    position.progress,
    position.chapter,
    position.passage,
    position.page,
    position.pages,
    now,
    now,
    md5,
  )
}

/**
 * Forgets where a book's e-books were read, such as when it is marked finished or not started;
 * its highlights, notes and bookmarks stay.
 */
export async function forgetReadingOf(workId: string) {
  const read = [...ebooks.values()].filter((ebook) => ebook.workId === workId)

  for (const ebook of read) {
    publish(ebook.md5, {
      ...ebook,
      location: null,
      progress: 0,
      chapter: null,
      passage: null,
      page: null,
      pages: null,
      lastReadAt: null,
    })
  }

  await database.runAsync(
    `UPDATE ebooks SET location = NULL, progress = 0, chapter = NULL, passage = NULL, page = NULL,
     pages = NULL, last_read_at = NULL, updated_at = ? WHERE work_id = ?`,
    Date.now(),
    workId,
  )
}

/** Remembers where each part of an e-book starts, as the reader found when opening it. */
/**
 * An e-book's contents with where each part starts, read from its file when not known yet, as the
 * reader learns them on opening it. Null when the file is not on the phone or cannot be read; the
 * reader then learns them as it opens.
 */
export async function learnSections(md5: string) {
  const ebook = getEbook(md5)

  if (!ebook || ebook.sections || !readyToRead(md5)) {
    return ebook?.sections ?? null
  }

  try {
    const parsed = z
      .array(ebookSection)
      .safeParse(JSON.parse(await readBookSections(ebookUri(md5))))

    if (!parsed.success) {
      return null
    }

    await saveSections(md5, parsed.data)

    return parsed.data
  } catch {
    return null
  }
}

export async function saveSections(md5: string, sections: EbookSection[]) {
  const ebook = getEbook(md5)

  if (!ebook || JSON.stringify(ebook.sections) === JSON.stringify(sections)) {
    return
  }

  publish(md5, { ...ebook, sections })
  await database.runAsync(
    'UPDATE ebooks SET sections = ? WHERE md5 = ?',
    JSON.stringify(sections),
    md5,
  )
}

/**
 * Makes a file the one a Hardcover book is read in. Nothing is downloaded: reading it fetches it,
 * and keeping it for offline reading is the listener's own choice.
 */
export async function chooseEbook(result: EbookResult, workId: string) {
  const previous = getEbook(result.md5)

  await save({ ...recordOf(result, previous, workId), workId, chosenAt: Date.now() })
}

export const markKinds = ['highlight', 'bookmark'] as const

export type MarkKind = (typeof markKinds)[number]

export const highlightColors = ['yellow', 'green', 'blue', 'pink'] as const

export type HighlightColor = (typeof highlightColors)[number]

const markRow = z.object({
  id: z.number(),
  md5: z.string(),
  kind: z.enum(markKinds),
  location: z.string(),
  text: z.string().nullable(),
  note: z.string().nullable(),
  color: z.enum(highlightColors).nullable().catch(null),
  created_at: z.number(),
})

/** A highlight of a passage or a bookmark of a place in the book. */
export type EbookMark = {
  id: number
  md5: string
  kind: MarkKind
  location: string
  text: string | null
  note: string | null
  color: HighlightColor | null
  createdAt: number
}

export async function listMarks(md5: string): Promise<EbookMark[]> {
  const rows = await database.getAllAsync<unknown>(
    'SELECT * FROM ebook_marks WHERE md5 = ? ORDER BY created_at',
    md5,
  )

  return rows.flatMap((row) => {
    const parsed = markRow.safeParse(row)

    return parsed.success
      ? [
          {
            id: parsed.data.id,
            md5: parsed.data.md5,
            kind: parsed.data.kind,
            location: parsed.data.location,
            text: parsed.data.text,
            note: parsed.data.note,
            color: parsed.data.color,
            createdAt: parsed.data.created_at,
          },
        ]
      : []
  })
}

export async function addMark(mark: Omit<EbookMark, 'id' | 'createdAt'>) {
  const result = await database.runAsync(
    `INSERT INTO ebook_marks (md5, kind, location, text, note, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    mark.md5,
    mark.kind,
    mark.location,
    mark.text,
    mark.note,
    mark.color,
    Date.now(),
  )

  return result.lastInsertRowId
}

/** Changes a highlight's note or colour. */
export async function updateMark(
  id: number,
  changes: { note: string | null; color: HighlightColor | null },
) {
  await database.runAsync(
    'UPDATE ebook_marks SET note = ?, color = ? WHERE id = ?',
    changes.note,
    changes.color,
    id,
  )
}

export async function deleteMark(id: number) {
  await database.runAsync('DELETE FROM ebook_marks WHERE id = ?', id)
}

/** Bytes the e-books kept on the phone take. */
export function ebookBytes(all: Map<string, Ebook>) {
  let bytes = 0

  for (const ebook of all.values()) {
    bytes += ebook.kept ? ebook.total : 0
  }

  return bytes
}
