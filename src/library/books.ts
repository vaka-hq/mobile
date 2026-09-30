import { readMediaInfo } from '@/media/media-info'
import { getPreferences } from '@/settings/preferences'
import { requireTorBoxKey } from '@/settings/torbox-key'
import { fetchBook } from '@/sources/audiobookbay/client'
import { abbParserVersion, magnetLink } from '@/sources/audiobookbay/parse'
import { bookForRecording, type HardcoverWork } from '@/sources/hardcover/client'
import { bestMatch, searchableTitle } from '@/sources/hardcover/match'
import {
  createTorrent,
  deleteTorrent,
  fetchTorrent,
  listTorrents,
  type TorBoxTorrent,
  TorBoxError,
} from '@/sources/torbox/client'
import { audioTracks } from '@/sources/torbox/tracks'
import { abbReader } from './abb-reader'
import { hardcoverBook, hardcoverSearch } from './catalog'
import { type BookRecord, workIdOf } from './model'
import {
  appTorrents,
  clearTorrent,
  clearTorrentId,
  getBook,
  listPendingTorrents,
  saveAbb,
  saveHardcover,
  saveTimeline,
  saveTorrent,
  saveTorrentId,
  unlinkStream,
} from './repository'
import { streamUrl } from './streams'
import { buildChapters } from './timeline'
import {
  forgetRemoved,
  rememberCached,
  rememberRemoved,
  removedRecently,
  torBoxCachedHashes,
} from './torbox-cache'

async function stored(id: string) {
  const book = await getBook(id)

  if (!book) {
    throw new Error('The audiobook could not be saved on this device')
  }

  return book
}

/** Posts rarely change after upload; a day-old copy is refreshed in the background of a visit. */
const abbRefreshAfterMs = 24 * 60 * 60 * 1000

/**
 * The book from the local cache, refreshed from AudioBookBay once it is a day old (or never seen).
 * A failed refresh keeps the cached copy so saved books always open offline.
 */
export async function loadBook(id: string, signal?: AbortSignal) {
  const cached = await getBook(id)

  if (
    cached &&
    cached.abb.parser >= abbParserVersion &&
    Date.now() - cached.abbFetchedAt < abbRefreshAfterMs
  ) {
    return cached
  }

  try {
    await saveAbb(await fetchBook(getPreferences().abbBaseUrl, id, signal, abbReader()))
  } catch (error) {
    if (cached) {
      return cached
    }

    throw error
  }

  return stored(id)
}

/** The posted recording's narrator and language pick the matching Hardcover audiobook edition. */
function recording(book: BookRecord | null) {
  return { narrator: book?.abb.narrator ?? null, language: book?.abb.language ?? null }
}

/** Links a book to Hardcover once, automatically; later visits reuse the stored metadata. */
export async function matchHardcover(book: BookRecord, signal?: AbortSignal) {
  if (book.matchState === 'matched' || book.matchState === 'manual') {
    if (book.hardcoverId !== null && !book.hardcover) {
      await saveHardcover(
        book.id,
        book.matchState,
        await hardcoverBook(book.hardcoverId, recording(book), signal),
      )

      return stored(book.id)
    }

    return book
  }

  if (book.matchState === 'unmatched') {
    return book
  }

  const title = searchableTitle(book.abb.title)
  const author = book.abb.author
  let hits = await hardcoverSearch(author ? `${title} ${author}` : title, signal)

  if (hits.length === 0 && author) {
    hits = await hardcoverSearch(title, signal)
  }

  const match = bestMatch(hits, book.abb.title, author)

  await saveHardcover(
    book.id,
    match ? 'matched' : 'unmatched',
    match ? await hardcoverBook(match.id, recording(book), signal) : null,
  )

  return stored(book.id)
}

/**
 * The listener's own choice of Hardcover book, or null to keep AudioBookBay's details. The
 * recording stops being the one any other book plays.
 */
export async function chooseHardcover(bookId: string, hardcoverId: number | null) {
  await saveHardcover(
    bookId,
    hardcoverId === null ? 'unmatched' : 'manual',
    hardcoverId === null
      ? null
      : await hardcoverBook(hardcoverId, recording(await getBook(bookId))),
  )
  await unlinkStream(bookId, workIdOf({ id: bookId, hardcoverId }))
}

/**
 * Opening an upload from its Hardcover book is the listener's choice of match, so the post takes
 * that book's details for the recording it holds, replacing any automatic match.
 */
export async function linkRecording(bookId: string, work: HardcoverWork) {
  const book = await stored(bookId)

  await saveHardcover(book.id, 'manual', bookForRecording(work, recording(book)))
}

/**
 * Where a book stands on TorBox. A download is `stalled` when TorBox says it has stopped getting
 * anywhere, such as for want of anyone sharing it.
 */
export type TorBoxStatus =
  | { kind: 'ready'; torrentId: number }
  | {
      kind: 'downloading'
      torrentId: number
      progress: number
      state: string | null
      stalled: boolean
    }
  | { kind: 'noAudio'; torrentId: number }
  | { kind: 'cached' }
  | { kind: 'notCached' }

/** TorBox's states for a download that has stopped moving. */
const stalledStates = /stalled|error|fail/iu

function sameHash(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Whether an error looking a torrent up by its ID means TorBox no longer has it, rather than that
 * TorBox could not answer: a rejected key, a rate limit or a server error says nothing about it.
 */
function torrentGone(error: Error) {
  return (
    error instanceof TorBoxError &&
    error.status !== null &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 403 &&
    error.status !== 429 &&
    error.code !== 'BAD_TOKEN' &&
    error.code !== 'AUTH_ERROR'
  )
}

/**
 * The listener's torrent of the book: the one stored for it, else one found by its hash. When
 * the stored one is still downloading, a finished copy of the same torrent wins, as one added
 * twice can leave a stalled copy behind the one that finished.
 */
async function ownTorrent(apiKey: string, book: BookRecord, signal?: AbortSignal) {
  let stored: TorBoxTorrent | null = null

  if (book.torrentId !== null) {
    try {
      const torrent = await fetchTorrent(apiKey, book.torrentId, signal)

      if (sameHash(torrent.hash, book.abb.infoHash)) {
        stored = torrent
      }
    } catch (error) {
      // A torrent removed from TorBox is looked up again by hash below.
      if (!(error instanceof Error && torrentGone(error))) {
        throw error
      }
    }
  }

  if (stored && isFinished(stored)) {
    return stored
  }

  // A torrent this app just removed may still be listed; it is gone.
  if (!stored && (await removedRecently(book.abb.infoHash))) {
    return null
  }

  const copies = (await listTorrents(apiKey, signal)).filter((torrent) =>
    sameHash(torrent.hash, book.abb.infoHash),
  )

  return copies.find(isFinished) ?? stored ?? copies[0] ?? null
}

async function readyStatus(book: BookRecord, torrent: TorBoxTorrent): Promise<TorBoxStatus> {
  const tracks = audioTracks(torrent.files ?? [])

  if (tracks.length === 0) {
    return { kind: 'noAudio', torrentId: torrent.id }
  }

  const known =
    book.torrentId === torrent.id &&
    book.tracks?.length === tracks.length &&
    book.tracks.every((track, index) => track.fileId === tracks[index]?.fileId)

  if (!known) {
    await saveTorrent(book.id, torrent.id, tracks)
    await rememberCached(book.abb.infoHash)
  }

  return { kind: 'ready', torrentId: torrent.id }
}

/** Where the audiobook stands on TorBox: streamable, downloading, instantly available or not. */
export async function torBoxStatus(given: BookRecord, signal?: AbortSignal): Promise<TorBoxStatus> {
  const apiKey = requireTorBoxKey()
  // Read afresh: a screen's copy can predate the torrent being added moments ago.
  const book = (await getBook(given.id)) ?? given
  const torrent = await ownTorrent(apiKey, book, signal)

  if (torrent) {
    if (isFinished(torrent)) {
      return readyStatus(book, torrent)
    }

    return {
      kind: 'downloading',
      torrentId: torrent.id,
      progress: torrent.progress ?? 0,
      state: torrent.download_state ?? null,
      stalled: stalledStates.test(torrent.download_state ?? ''),
    }
  }

  const cached = await torBoxCachedHashes(apiKey, [book.abb.infoHash], signal)

  return cached.has(book.abb.infoHash.toLowerCase()) ? { kind: 'cached' } : { kind: 'notCached' }
}

/** Adds the torrent to the listener's TorBox; cached torrents become streamable at once. */
export async function addToTorBox(book: BookRecord) {
  return createTorrent(requireTorBoxKey(), magnetLink(book.abb), book.abb.title)
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = []
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next

      next += 1
      const item = items[index]

      if (item !== undefined) {
        results[index] = await work(item, index)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return results
}

/** Beyond this many files, lengths are estimated from the bitrate and corrected during playback. */
const maxMeasuredTracks = 24

/**
 * Measures each file and reads its embedded chapters with a few small range requests, so the
 * chapter list and book duration exist before playback starts. Files that cannot be read still
 * play; their length is learned from the player.
 */
export async function prepareTimeline(book: BookRecord) {
  if (!book.tracks || book.torrentId === null) {
    return book
  }

  if (book.chapters && book.durations?.every((duration) => duration !== null)) {
    return book
  }

  const torrentId = book.torrentId

  if (book.tracks.length > maxMeasuredTracks) {
    const kbps = Number(/(\d+)\s*kbps/iu.exec(book.abb.bitrate ?? '')?.[1] ?? 0)

    await saveTimeline(
      book.id,
      book.tracks.map(
        (track, index) =>
          book.durations?.[index] ?? (kbps > 0 ? (track.size * 8) / (kbps * 1000) : null),
      ),
      buildChapters(book.tracks, []),
    )

    return stored(book.id)
  }

  const failures: Error[] = []

  const infos = await mapLimited(book.tracks, 4, async (track) => {
    try {
      const { url } = await streamUrl(torrentId, track.fileId)

      return await readMediaInfo(url, track.format)
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))

      return null
    }
  })

  // Nothing could be read, most likely a network problem: keep the timeline unset so the next
  // visit tries again, instead of storing file-name chapters for good.
  if (failures.length === book.tracks.length && failures[0]) {
    throw failures[0]
  }

  await saveTimeline(
    book.id,
    infos.map((info, index) => info?.duration ?? book.durations?.[index] ?? null),
    buildChapters(book.tracks, infos),
  )

  return stored(book.id)
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Makes a book streamable: adds it to TorBox when needed and waits briefly for cached torrents to
 * finish. Returns the final status; `downloading` means TorBox is still fetching it.
 *
 * TorBox's torrent list catches up with new torrents only after a while, so the ID returned when
 * adding is stored at once and every later check looks the torrent up by that ID.
 */
export async function ensureStreamable(bookId: string): Promise<TorBoxStatus> {
  let book = await stored(bookId)
  let status = await torBoxStatus(book)

  if (status.kind === 'cached' || status.kind === 'notCached') {
    const wasCached = status.kind === 'cached'

    await saveTorrentId(bookId, await addToTorBox(book))
    await forgetRemoved(book.abb.infoHash)

    // A new torrent takes a few seconds to appear in the listener's list, and until it does the
    // book still reads as cached or missing, so those are waited out too. An uncached torrent that
    // has started downloading will not finish in seconds, so there is no point waiting for it.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await wait(1500)
      book = await stored(bookId)
      status = await torBoxStatus(book)

      if (
        status.kind === 'ready' ||
        status.kind === 'noAudio' ||
        (status.kind === 'downloading' && !wasCached)
      ) {
        break
      }
    }
  }

  return status
}

async function torrentExists(apiKey: string, torrentId: number) {
  try {
    await fetchTorrent(apiKey, torrentId)

    return true
  } catch (error) {
    if (error instanceof Error && torrentGone(error)) {
      return false
    }

    throw error
  }
}

/** TorBox's states for a torrent whose files are all in the listener's TorBox. */
const doneStates = new Set(['completed', 'uploading', 'seeding', 'cached'])

/**
 * Whether a torrent's files can be streamed: its files are there, or TorBox says it is done, or
 * it has reached the end in a state that only follows a finished download. TorBox can report the
 * last of these a while before it sets its finished flag.
 */
function isFinished(torrent: TorBoxTorrent) {
  if (torrent.download_present === false) {
    return false
  }

  const state = torrent.download_state?.toLowerCase() ?? ''

  return (
    torrent.download_present === true ||
    Boolean(torrent.download_finished) ||
    ((torrent.progress ?? 0) >= 1 && [...doneStates].some((done) => state.startsWith(done)))
  )
}

/** A torrent in the listener's TorBox, as far as showing its download goes. */
export type TorBoxDownload = { torrentId: number; progress: number; finished: boolean }

/** The listener's TorBox torrents by lowercased info hash, for showing download progress. */
export async function torBoxDownloads(signal?: AbortSignal) {
  const listed = await listTorrents(requireTorBoxKey(), signal)
  const removed = await Promise.all(listed.map((torrent) => removedRecently(torrent.hash)))
  const downloads = new Map<string, TorBoxDownload>()

  for (const [index, torrent] of listed.entries()) {
    const hash = torrent.hash.toLowerCase()
    const known = downloads.get(hash)

    // Of a torrent added twice, the finished copy is the one that counts.
    if (!removed[index] && !known?.finished) {
      downloads.set(hash, {
        torrentId: torrent.id,
        progress: torrent.progress ?? 0,
        finished: isFinished(torrent),
      })
    }
  }

  return downloads
}

/** Stops TorBox downloading a book and removes its torrent; it can be added again later. */
export async function cancelDownload(bookId: string) {
  const apiKey = requireTorBoxKey()
  const book = await stored(bookId)
  const status = await torBoxStatus(book)

  if (status.kind === 'downloading') {
    await removeTorrent(apiKey, status.torrentId)
  }

  await rememberRemoved(book.abb.infoHash)
  await clearTorrent(bookId)
}

async function removeTorrent(apiKey: string, torrentId: number) {
  try {
    await deleteTorrent(apiKey, torrentId)
  } catch (error) {
    // TorBox refuses to delete a torrent that is already gone, which is what was wanted.
    if (await torrentExists(apiKey, torrentId)) {
      throw error
    }
  }
}

/** A torrent TorBox is still downloading, which a new download would have to replace. */
export type ActiveDownload = { torrentId: number; hash: string; name: string }

/**
 * The torrents this app added that TorBox is still downloading. Torrents added moments ago are
 * looked up by ID as well, since TorBox's list is slow to show them. The listener's other
 * torrents, and any TorBox has finished, even if its files are not there now, never count.
 */
export async function activeDownloads(signal?: AbortSignal) {
  const apiKey = requireTorBoxKey()
  const active = new Map<number, ActiveDownload>()
  const ours = await appTorrents()

  function note(torrent: TorBoxTorrent) {
    const own = ours.ids.has(torrent.id) || ours.hashes.has(torrent.hash.toLowerCase())

    if (own && !isFinished(torrent) && !torrent.download_finished) {
      active.set(torrent.id, { torrentId: torrent.id, hash: torrent.hash, name: torrent.name })
    }
  }

  for (const torrent of await listTorrents(apiKey, signal)) {
    if (!(await removedRecently(torrent.hash))) {
      note(torrent)
    }
  }

  for (const torrentId of await listPendingTorrents()) {
    if (!active.has(torrentId)) {
      try {
        note(await fetchTorrent(apiKey, torrentId, signal))
      } catch {
        // Gone from TorBox, so not downloading.
      }
    }
  }

  return [...active.values()]
}

/** Stops the given downloads, such as to make room for a new one. */
export async function cancelDownloads(downloads: ActiveDownload[]) {
  const apiKey = requireTorBoxKey()

  for (const download of downloads) {
    await removeTorrent(apiKey, download.torrentId)
    await rememberRemoved(download.hash)
    await clearTorrentId(download.torrentId)
  }
}
