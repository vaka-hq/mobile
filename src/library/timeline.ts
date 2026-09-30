import type { MediaInfo } from '@/media/media-info'
import type { Track } from '@/sources/torbox/tracks'
import type { Chapter } from './model'

/** Chapters for the whole book: embedded markers where present, otherwise one per file. */
export function buildChapters(tracks: Track[], infos: (MediaInfo | null)[]): Chapter[] {
  const chapters: Chapter[] = []

  tracks.forEach((track, index) => {
    const embedded = infos[index]?.chapters ?? []

    if (embedded.length > 1 || (tracks.length === 1 && embedded.length === 1)) {
      for (const chapter of embedded) {
        chapters.push({ title: chapter.title, track: index, start: chapter.start })
      }
    } else {
      chapters.push({ title: embedded[0]?.title || track.title, track: index, start: 0 })
    }
  })

  return chapters
}

/** Seconds from the start of the book; unknown track lengths count as zero. */
export function bookPosition(durations: (number | null)[], track: number, position: number) {
  let total = position

  for (let index = 0; index < track; index += 1) {
    total += durations[index] ?? 0
  }

  return total
}

/**
 * Seconds from the start of the book, only when every file before `track` has a known length;
 * null otherwise, rather than a place short by the lengths not known.
 */
export function knownPosition(durations: (number | null)[], track: number, position: number) {
  let total = position

  for (let index = 0; index < track; index += 1) {
    const duration = durations[index]

    if (duration === null || duration === undefined) {
      return null
    }

    total += duration
  }

  return total
}

export function bookDuration(durations: (number | null)[] | null) {
  if (!durations || durations.length === 0 || durations.some((duration) => duration === null)) {
    return null
  }

  return durations.reduce<number>((total, duration) => total + (duration ?? 0), 0)
}

/** The track and offset for a point in the book, clamped to its ends. */
export function locate(durations: (number | null)[], seconds: number) {
  let remaining = Math.max(0, seconds)

  for (let track = 0; track < durations.length; track += 1) {
    const duration = durations[track]

    if (
      duration === null ||
      duration === undefined ||
      remaining < duration ||
      track === durations.length - 1
    ) {
      return { track, position: duration ? Math.min(remaining, duration) : remaining }
    }

    remaining -= duration
  }

  return { track: 0, position: 0 }
}

/**
 * Moves a position by a number of seconds, crossing into neighbouring files only where their
 * lengths are known; otherwise it stops at the start or end of the current file.
 */
export function offsetPosition(
  durations: (number | null)[],
  track: number,
  position: number,
  seconds: number,
) {
  let current = track
  let target = position + seconds

  while (
    target < 0 &&
    current > 0 &&
    durations[current - 1] !== null &&
    durations[current - 1] !== undefined
  ) {
    current -= 1
    target += durations[current] ?? 0
  }

  while (
    current < durations.length - 1 &&
    durations[current] !== null &&
    durations[current] !== undefined &&
    target >= (durations[current] ?? 0)
  ) {
    target -= durations[current] ?? 0
    current += 1
  }

  const length = durations[current]

  return {
    track: current,
    position: Math.max(
      0,
      length === null || length === undefined ? target : Math.min(target, length),
    ),
  }
}

export function chapterIndexAt(chapters: Chapter[], track: number, position: number) {
  let current = 0

  chapters.forEach((chapter, index) => {
    if (chapter.track < track || (chapter.track === track && chapter.start <= position + 0.25)) {
      current = index
    }
  })

  return current
}

/** Where a chapter ends inside its track, or null when the track length is still unknown. */
export function chapterEnd(chapters: Chapter[], index: number, durations: (number | null)[]) {
  const chapter = chapters[index]
  const next = chapters[index + 1]

  if (!chapter) {
    return null
  }

  if (next && next.track === chapter.track) {
    return next.start
  }

  return durations[chapter.track] ?? null
}
