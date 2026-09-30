import type { BookRecord, Playback } from '@/library/model'
import { bookDuration, bookPosition, chapterEnd, chapterIndexAt } from '@/library/timeline'

export type PlaybackSummary = {
  chapterIndex: number
  chapterCount: number
  chapterTitle: string | null
  /** Seconds into the current chapter. */
  chapterElapsed: number
  /** Chapter length, or the track's when chapters are unknown; null until measured. */
  chapterLength: number | null
  bookElapsed: number
  bookTotal: number | null
}

/** Where the listener is in the chapter and the book, for sliders and remaining-time labels. */
export function summarize(
  book: BookRecord,
  track: number,
  position: number,
  trackDuration: number | null,
): PlaybackSummary {
  const chapters = book.chapters ?? []
  const durations = [...(book.durations ?? book.tracks?.map(() => null) ?? [])]

  if (trackDuration !== null && durations[track] === null) {
    durations[track] = trackDuration
  }

  const chapterIndex = chapterIndexAt(chapters, track, position)
  const chapter = chapters[chapterIndex]
  const onTrack = chapter?.track === track
  const start = onTrack ? chapter.start : 0
  const end = onTrack ? chapterEnd(chapters, chapterIndex, durations) : trackDuration

  return {
    chapterIndex,
    chapterCount: chapters.length,
    chapterTitle: onTrack ? chapter.title || null : null,
    chapterElapsed: Math.max(0, position - start),
    chapterLength: end === null ? null : Math.max(0, end - start),
    bookElapsed: bookPosition(durations, track, position),
    bookTotal: bookDuration(durations),
  }
}

/** Listening progress for library rows, from 0 to 1, or null when not started or unknown. */
export function listeningProgress(book: BookRecord, playback: Playback | null) {
  if (!playback) {
    return null
  }

  if (playback.finished) {
    return 1
  }

  const total = bookDuration(book.durations)

  if (!total || !book.durations) {
    return null
  }

  return bookPosition(book.durations, playback.track, playback.position) / total
}
