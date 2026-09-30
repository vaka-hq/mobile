import { z } from 'zod'
import type { AbbBook } from '@/sources/audiobookbay/parse'
import type { HardcoverBook, HardcoverWork } from '@/sources/hardcover/client'
import type { Track } from '@/sources/torbox/tracks'

/** A chapter start inside one track; it ends where the next chapter or its track ends. */
export const chapterSchema = z.object({
  title: z.string(),
  track: z.number(),
  start: z.number(),
})

export type Chapter = z.infer<typeof chapterSchema>

/**
 * How the Hardcover link was made. Automatic matching runs once; a listener's choice (or their
 * decision that nothing matches) is never overwritten.
 */
export const matchStates = ['pending', 'matched', 'unmatched', 'manual'] as const

export type MatchState = (typeof matchStates)[number]

/**
 * One audiobook upload (a stream): the AudioBookBay post, its TorBox torrent and what was learned
 * from the media. Progress and bookmarks belong to a stream, since recordings differ in length.
 */
export type BookRecord = {
  id: string
  abb: AbbBook
  /** When the AudioBookBay details were last downloaded. */
  abbFetchedAt: number
  hardcoverId: number | null
  hardcover: HardcoverBook | null
  matchState: MatchState
  torrentId: number | null
  tracks: Track[] | null
  /** Seconds per track, null until measured. */
  durations: (number | null)[] | null
  chapters: Chapter[] | null
  /** When this stream was last played. */
  lastPlayedAt: number | null
}

/**
 * A book as the listener collects it: a Hardcover book, or an AudioBookBay post Hardcover does
 * not know. It remembers the stream last chosen or played.
 */
export type WorkRecord = {
  /** `hardcover:<id>` or `post:<AudioBookBay id>`. */
  id: string
  hardcoverId: number | null
  /** Hardcover's details, kept so the library can show books whose streams are not loaded. */
  work: HardcoverWork | null
  streamId: string | null
  inLibrary: boolean
  addedAt: number | null
  lastPlayedAt: number | null
  /** When the listener marked the book finished; playing it again clears it. */
  finishedAt: number | null
}

export function hardcoverWorkId(hardcoverId: number) {
  return `hardcover:${hardcoverId}`
}

export function postWorkId(postId: string) {
  return `post:${postId}`
}

/** Where a book opens: its Hardcover page, or the post page for a book Hardcover does not know. */
export function workPath(
  work: Pick<WorkRecord, 'id' | 'hardcoverId' | 'streamId'>,
): `/work/${number}` | `/book/${string}` {
  return work.hardcoverId !== null
    ? `/work/${work.hardcoverId}`
    : `/book/${work.streamId ?? work.id.replace(/^post:/u, '')}`
}

/** The book a stream belongs to: its Hardcover book when matched, else the post itself. */
export function workIdOf(book: Pick<BookRecord, 'id' | 'hardcoverId'>) {
  return book.hardcoverId !== null ? hardcoverWorkId(book.hardcoverId) : postWorkId(book.id)
}

export type Playback = {
  bookId: string
  track: number
  position: number
  speed: number
  finished: boolean
  updatedAt: number
}

export type Bookmark = {
  id: number
  bookId: string
  track: number
  position: number
  note: string | null
  createdAt: number
}

/** A book in the library with its current stream and that stream's progress, when there is one. */
export type LibraryEntry = {
  work: WorkRecord
  book: BookRecord | null
  playback: Playback | null
}

/** A stream with its progress, for restoring the player. */
export type StreamEntry = {
  book: BookRecord
  playback: Playback | null
}

/** The size of a recording's files together, in bytes, as the upload lists them. */
export function recordingBytes(book: Pick<BookRecord, 'tracks'>) {
  return (book.tracks ?? []).reduce((sum, track) => sum + track.size, 0)
}
