import { useEffect, useState } from 'react'
import { stopIfAborted } from '@/lib/abort'
import { getPreferences, usePreferences } from '@/settings/preferences'
import { Speech } from '../../modules/speech'
import { type Ebook, learnSections, listEbooks } from './ebooks'
import { type BookRecord, workIdOf } from './model'
import { offlineTrackUri } from './offline'
import {
  audioParts,
  type AudioPart,
  listeningToReading,
  locatePassage,
  readingToListening,
  type TextPart,
} from './reading-sync'
import { getBook, getPlayback, getWork, lastHeardStream } from './repository'
import { speechModelUri, speechUnderstands } from './speech-model'
import { streamUrl } from './streams'
import { bookDuration, knownPosition, locate } from './timeline'

/**
 * Carrying a place between listening to a book and reading it. The two places are kept apart and
 * only meet when the listener says so: opening the reader after listening more recently asks
 * whether to read on from there, starting playback after reading more recently asks the same, and
 * the switch buttons between the player and the reader carry the place over without asking. The
 * chapter estimate is used as it is, or with the speech model the words around it are heard to
 * find the exact place.
 */

/**
 * How far apart listening and reading must be, in seconds of audio, to ask where to start. Both
 * ways compare the same way; a place carried over by a switch lands on the other one and is not
 * asked about again, while a little listening or reading beyond it is.
 */
const apartSeconds = 10

/** How much of the listening before its place is heard to find it in the text, in seconds. */
const heardBefore = 25

/** How much audio around an estimate is heard to find where reading stopped, in seconds. */
const heardAround = 60

/** How long before the page's first word listening starts, in seconds. */
const leadIn = 1.2

/** Where the listener stopped in a book's current recording. */
async function listened(workId: string) {
  // The upload listened to last, which may not be the one chosen for the book.
  const bookId = (await lastHeardStream(workId)) ?? (await getWork(workId))?.streamId ?? null
  const book = bookId ? await getBook(bookId) : null
  const playback = book ? await getPlayback(book.id) : null
  const parts = book ? audioParts(book.chapters, book.durations) : null

  const seconds =
    book?.durations && playback
      ? knownPosition(book.durations, playback.track, playback.position)
      : null

  if (!book || !playback || playback.finished || !parts || seconds === null) {
    return null
  }

  return { book, playback, parts, seconds }
}

/** Where a track of a recording can be read from: the copy on the phone, or its stream. */
async function trackSource(book: BookRecord, track: number) {
  const offline = offlineTrackUri(book, track)
  const file = book.tracks?.[track]

  if (offline) {
    return offline
  }

  if (!file || book.torrentId === null) {
    return null
  }

  return (await streamUrl(book.torrentId, file.fileId)).url
}

/** Whether the exact mode can run for a book in `language`. */
function hearsExactly(language: string | null | undefined) {
  return (
    getPreferences().readingSync === 'words' &&
    speechModelUri() !== null &&
    speechUnderstands(language)
  )
}

/** The words heard just before listening stopped, to find that place in the text. */
async function heardBeforeStop(book: BookRecord, track: number, position: number) {
  const model = speechModelUri()
  const source = Speech ? await trackSource(book, track) : null
  const start = Math.max(0, position - heardBefore)

  if (!Speech || !source || !model || position - start < 4) {
    return null
  }

  const { words } = await Speech.transcribe({ source, start, duration: position - start, model })

  return words.map((word) => word.word)
}

/** A place worked out before the reader opens, for it to open at. */
export type PreparedPlace = {
  fraction: number
  /** Words heard just before listening stopped, for the reader to find exactly. */
  words: string[] | null
}

const prepared = new Map<string, PreparedPlace>()

/** The place prepared for an e-book, which the reader opens at instead of its own place. */
export function preparedPlace(md5: string) {
  return prepared.get(md5) ?? null
}

/** Forgets a prepared place once the reader has it, so a later visit opens at the reading. */
export function forgetPreparedPlace(md5: string) {
  prepared.delete(md5)
}

/**
 * Works out, before the reader opens, where a book was last listened to in its e-book, and keeps
 * it for the reader. False when that cannot be known yet, such as for an e-book never opened,
 * whose parts the reader has not seen; the reader then finds it once it opens.
 */
export async function prepareReadingPlace(ebook: Ebook, workId: string, signal: AbortSignal) {
  const heard = await listened(workId)
  // A book downloaded but not opened yet has its contents read from the file now.
  const sections = ebook.sections ?? (await learnSections(ebook.md5))

  stopIfAborted(signal)

  if (!heard || !sections) {
    return false
  }

  const place = listeningToReading(heard.parts, sections, heard.seconds)

  if (!place) {
    return false
  }

  const words = hearsExactly(ebook.language ?? heard.book.abb.language)
    ? await heardBeforeStop(heard.book, heard.playback.track, heard.playback.position).catch(
        () => null,
      )
    : null

  stopIfAborted(signal)
  prepared.set(ebook.md5, { fraction: place.fraction, words })

  return true
}

export type FromListening = {
  /** The e-book part the listener reached, when it has a name. */
  label: string | null
  /** How far into the e-book, as the chapters estimate it. */
  fraction: number
  /**
   * The words heard just before the listener stopped, to find the exact place in the text; null
   * when the exact mode is off or the words cannot be heard.
   */
  hear: () => Promise<string[] | null>
}

/**
 * Where the book was last listened to, for the reader, once the listener chose to read on from
 * there or switched here from the player. `sections` are the e-book's parts as the reader opened
 * it.
 */
export function useFromListening(
  ebook: Ebook | null,
  sections: TextPart[] | null,
  /** Chosen, or switched here from the player: the place carries over. */
  force: boolean,
) {
  const { readingSync } = usePreferences()
  const [offer, setOffer] = useState<FromListening | null>(null)
  const md5 = ebook?.md5 ?? null
  const workId = ebook?.workId ?? null
  const ready = sections !== null && sections.length > 0

  useEffect(() => {
    // Asking happens before the reader opens; here only a switch from the player carries over.
    if (!force || readingSync === 'off' || !workId || !md5 || !ready || !sections) {
      setOffer(null)

      return
    }

    let current = true

    void listened(workId)
      .then((heard) => {
        if (!current || !heard) {
          return
        }

        const place = listeningToReading(heard.parts, sections, heard.seconds)

        if (!place) {
          return
        }

        const { book, playback } = heard

        setOffer({
          label: place.label,
          fraction: place.fraction,
          hear: async () =>
            hearsExactly(ebook?.language ?? book.abb.language)
              ? heardBeforeStop(book, playback.track, playback.position)
              : null,
        })
      })
      .catch(() => undefined)

    return () => {
      current = false
    }
  }, [readingSync, workId, md5, ready, sections, force, ebook?.language])

  return { offer, dismiss: () => setOffer(null) }
}

/**
 * Where a book was last listened to, when that is newer than the reading of `ebook` and elsewhere:
 * how far in, in seconds, and how long the book is when that is known. Null when reading is as recent, nothing
 * was heard, or listening and reading are kept apart.
 */
export async function newerListening(workId: string, ebook: Ebook | null) {
  if (getPreferences().readingSync === 'off') {
    return null
  }

  const heard = await listened(workId)

  if (!heard || heard.playback.updatedAt <= (ebook?.lastReadAt ?? 0)) {
    return null
  }

  // Listening that ended where the reading already is needs no question.
  const reading = ebook?.sections
    ? readingToListening(heard.parts, ebook.sections, ebook.progress)
    : null

  if (reading && Math.abs(reading.seconds - heard.seconds) < apartSeconds) {
    return null
  }

  return { seconds: heard.seconds, total: bookDuration(heard.book.durations) }
}

/** The e-book of a book read most recently, with what matching needs. */
export function readEbookOf(workId: string) {
  return listEbooks()
    .filter((ebook) => ebook.workId === workId && ebook.lastReadAt !== null && ebook.sections)
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0]
}

/**
 * The e-book of a recording's book when it was read after the recording was last listened to,
 * with the audio chapter reading reached; null when listening is as recent, or they are kept apart.
 */
export function newerReading(book: BookRecord, listened: number, listeningAt: number | null) {
  const ebook = readEbookOf(workIdOf(book))
  const parts = audioParts(book.chapters, book.durations)

  if (
    getPreferences().readingSync === 'off' ||
    !ebook?.sections ||
    !parts ||
    (ebook.lastReadAt ?? 0) <= listened
  ) {
    return null
  }

  const place = readingToListening(parts, ebook.sections, ebook.progress)

  // Reading that ended where the listening already is needs no question.
  if (!place || (listeningAt !== null && Math.abs(place.seconds - listeningAt) < apartSeconds)) {
    return null
  }

  return { ebook, title: place.title }
}

/** The top of the page being read, as far as matching it with the recording needs. */
export type ReadingPlace = {
  /** How far into the book the page starts. */
  progress: number
  /** The words at the top of the page, to hear in the audio. */
  passage: string | null
  sections: TextPart[]
  language: string | null
}

/**
 * Where a reading place is in a recording: the chapter estimate, or with the exact mode, where
 * its words are heard near it. Null when the recording's chapters or lengths are not known yet.
 */
export async function listeningPlaceFor(
  book: BookRecord,
  reading: ReadingPlace,
  signal?: AbortSignal,
) {
  const parts = audioParts(book.chapters, book.durations)
  const place = parts ? readingToListening(parts, reading.sections, reading.progress) : null

  if (!parts || !place || !book.durations) {
    return null
  }

  const found = hearsExactly(reading.language ?? book.abb.language)
    ? await hearPassage(book, parts, place.seconds, reading.passage, signal).catch(
        (error: Error) => {
          // Cancelled, the search stops; any other failure falls back to the chapter estimate.
          if (signal?.aborted) {
            throw error
          }

          return null
        },
      )
    : null

  // Listening starts at the top of the page reading reached, a moment early so its first word is
  // heard whole.
  return found
    ? { track: found.track, position: Math.max(0, found.position - leadIn) }
    : locate(book.durations, place.seconds)
}

/**
 * Where a book's e-book was last read, in its recording, for playing on from there; aborting
 * `signal` stops the search.
 */
export function listeningPlaceFromEbook(book: BookRecord, ebook: Ebook, signal?: AbortSignal) {
  return ebook.sections
    ? listeningPlaceFor(
        book,
        {
          progress: ebook.progress,
          passage: ebook.passage,
          sections: ebook.sections,
          language: ebook.language,
        },
        signal,
      )
    : Promise.resolve(null)
}

/** The recording a book is listened in, once it can play, for switching to it from the reader. */
export function useRecordingOf(workId: string | null) {
  const [book, setBook] = useState<BookRecord | null>(null)

  useEffect(() => {
    let current = true

    if (!workId) {
      setBook(null)

      return
    }

    void getWork(workId)
      .then((work) => (work?.streamId ? getBook(work.streamId) : null))
      .then((found) => {
        if (current) {
          setBook(found?.tracks ? found : null)
        }
      })
      .catch(() => undefined)

    return () => {
      current = false
    }
  }, [workId])

  return book
}

/**
 * Where the words reading stopped at are spoken, near `seconds` into the book: the minute around
 * the estimate is heard first, then the minutes before and after it.
 */
async function hearPassage(
  book: BookRecord,
  parts: AudioPart[],
  seconds: number,
  passage: string | null,
  signal?: AbortSignal,
) {
  const model = speechModelUri()

  if (!Speech || !model || !passage || !book.durations || parts.length === 0) {
    return null
  }

  for (const shift of [0, -heardAround, heardAround]) {
    if (signal) {
      stopIfAborted(signal)
    }

    const { track, position } = locate(book.durations, seconds + shift)
    const source = await trackSource(book, track)
    const start = Math.max(0, position - heardAround / 2)

    if (!source) {
      return null
    }

    const { words } = await Speech.transcribe({ source, start, duration: heardAround, model })

    if (signal) {
      stopIfAborted(signal)
    }

    const at = locatePassage(passage, words)

    if (at !== null) {
      return { track, position: at }
    }
  }

  return null
}
