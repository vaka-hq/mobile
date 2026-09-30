import type { AbbFeed } from '@/sources/audiobookbay/client'
import type { AbbBook, AbbListing, AbbListingPage } from '@/sources/audiobookbay/parse'
import type { HardcoverRecording, HardcoverWork } from '@/sources/hardcover/client'
import {
  creditScore,
  matchThreshold,
  normalize,
  pickEdition,
  searchableTitle,
  similarity,
} from '@/sources/hardcover/match'
import { splitTitle } from './display'
import { compareLanguages } from './languages'

/** Uploads of one book rarely run past two result pages; more requests only risk throttling. */
const maxPages = 2

/** Enough posts to cover every narrator; each one costs a page load on AudioBookBay. */
export const maxRecordings = 16

/** Below this many uploads from the title-and-author search, the bare title is searched too. */
const fewUploads = 3

function words(value: string) {
  return new Set(normalize(value).split(' ').filter(Boolean))
}

/** The short title AudioBookBay posts use: no Hardcover subtitle, no release notes. */
export function postedTitle(work: Pick<HardcoverWork, 'title' | 'subtitle'>) {
  return searchableTitle(splitTitle(work.title, work.subtitle).title.split(':')[0] ?? work.title)
}

/**
 * Whether a post is an upload of this book rather than a namesake, a sequel or a collection: every
 * word of the book's title appears in the post's title, the two are close overall, and the post's
 * author (when it names one) is one of the book's authors.
 */
export function isRecordingOf(
  post: Pick<AbbListing, 'title' | 'author'>,
  work: Pick<HardcoverWork, 'title' | 'subtitle' | 'authors'>,
) {
  const wanted = postedTitle(work)
  const posted = searchableTitle(post.title)
  const postedWords = words(posted)

  if (![...words(wanted)].every((word) => postedWords.has(word))) {
    return false
  }

  if (similarity(wanted, posted) < 0.5) {
    return false
  }

  return !post.author || work.authors.length === 0 || creditScore(post.author, work.authors) >= 0.5
}

/**
 * The book's uploads from AudioBookBay search: title and author first, then the title alone when
 * that finds little, since posts sometimes misspell the author.
 */
export async function findRecordingListings(
  work: Pick<HardcoverWork, 'title' | 'subtitle' | 'authors'>,
  loadPage: (feed: AbbFeed, page: number) => Promise<AbbListingPage>,
) {
  const title = postedTitle(work)
  const author = work.authors[0]
  const queries = author ? [`${title} ${author}`, title] : [title]
  const found = new Map<string, AbbListing>()

  for (const [index, query] of queries.entries()) {
    if (index > 0 && found.size >= fewUploads) {
      break
    }

    const feed: AbbFeed = { kind: 'search', query }

    for (let page = 1; page <= maxPages; page += 1) {
      const result = await loadPage(feed, page)

      for (const listing of result.items) {
        if (isRecordingOf(listing, work) && !found.has(listing.id)) {
          found.set(listing.id, listing)
        }
      }

      if (!result.hasNextPage) {
        break
      }
    }
  }

  return [...found.values()].slice(0, maxRecordings)
}

/** Uploads read by the same narrator, with the Hardcover edition of that recording when known. */
export type NarratorGroup = {
  key: string
  /** Empty for uploads that credit no narrator. */
  narrators: string[]
  recording: HardcoverRecording | null
  posts: AbbBook[]
}

/** The Hardcover recording read by this narrator, preferring the post's language and a cover. */
export function recordingFor(
  work: Pick<HardcoverWork, 'recordings'>,
  post: Pick<AbbBook, 'narrator' | 'language'>,
) {
  const candidates = work.recordings.map((recording) => ({
    ...recording,
    hasCover: recording.coverUrl !== null,
  }))

  return pickEdition(candidates, null, post.narrator, post.language)
}

/** Chapterised single-file formats play best. */
function formatRank(format: string | null) {
  const value = format?.toLowerCase() ?? ''

  return value.includes('m4b') ? 0 : value.includes('m4a') ? 1 : value.includes('mp3') ? 2 : 3
}

function bitrate(value: string | null) {
  return Number(/\d+/u.exec(value ?? '')?.[0] ?? 0)
}

/**
 * Best source first: in the preferred language, then English, then the others by name; then the
 * whole book over an abridged one, M4B over M4A over MP3, the higher bitrate and the newest upload.
 */
function comparePosts(byLanguage: (a: string | null, b: string | null) => number) {
  return (left: AbbBook, right: AbbBook) =>
    byLanguage(left.language, right.language) ||
    Number(left.abridged === true) - Number(right.abridged === true) ||
    formatRank(left.format) - formatRank(right.format) ||
    bitrate(right.bitrate) - bitrate(left.bitrate) ||
    (right.postedAt ?? '').localeCompare(left.postedAt ?? '')
}

/**
 * Groups uploads by who reads them. Recordings in the preferred language lead, then English, then
 * the others by name; within a language, narrators Hardcover knows lead, most read first, and
 * narrators only the posts name follow. Uploads crediting nobody come last.
 */
export function groupByNarrator(
  work: Pick<HardcoverWork, 'recordings'>,
  posts: AbbBook[],
  preferred: string,
) {
  const byLanguage = compareLanguages(preferred)
  const bestFirst = comparePosts(byLanguage)
  const groups: NarratorGroup[] = []
  const uncredited: AbbBook[] = []

  for (const post of posts) {
    const narrator = post.narrator

    if (!narrator) {
      uncredited.push(post)
      continue
    }

    const recording = recordingFor(work, post)

    const group = groups.find(
      (item) =>
        item.narrators.length > 0 && creditScore(narrator, item.narrators) >= matchThreshold,
    )

    if (group) {
      group.posts.push(post)
      group.recording ??= recording
      continue
    }

    const narrators = recording?.narrators.length
      ? recording.narrators
      : narrator
          .split(/,|&/u)
          .map((name) => name.trim())
          .filter(Boolean)

    groups.push({ key: normalize(narrators.join(' ')), narrators, recording, posts: [post] })
  }

  for (const group of groups) {
    group.posts.sort(bestFirst)
  }

  groups.sort(
    (left, right) =>
      byLanguage(left.posts[0]?.language ?? null, right.posts[0]?.language ?? null) ||
      Number(right.recording !== null) - Number(left.recording !== null) ||
      (right.recording?.usersCount ?? 0) - (left.recording?.usersCount ?? 0) ||
      right.posts.length - left.posts.length,
  )

  if (uncredited.length > 0) {
    groups.push({ key: 'uncredited', narrators: [], recording: null, posts: uncredited })
  }

  uncredited.sort(bestFirst)

  return groups
}

/** What sets one upload apart in its title: "[FIXED]", "(Re-Performed, New Ending 2014)". */
export function releaseNotes(title: string) {
  const notes: string[] = []

  for (const match of title.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/gu)) {
    const note = (match[1] ?? match[2] ?? '').trim()

    if (note && !/\b(?:read|narrated|performed)\s+by\b/iu.test(note)) {
      notes.push(note)
    }
  }

  return notes.join(', ')
}

/**
 * What Listen plays by default, in the language the recordings best suit the listener in, the
 * first group's: the best source TorBox already holds in it, so playback starts at once, from the
 * most read narrator who has one (groups come most read first, sources best first). With nothing
 * in that language cached, its most read narrator's best source, which TorBox then downloads.
 */
export function defaultStreamId(
  groups: NarratorGroup[],
  cached: Set<string> | null,
  preferred: string,
) {
  const byLanguage = compareLanguages(preferred)
  const language = groups[0]?.posts[0]?.language ?? null

  for (const group of groups) {
    const instant = group.posts.find(
      (post) =>
        byLanguage(post.language, language) === 0 && cached?.has(post.infoHash.toLowerCase()),
    )

    if (instant) {
      return instant.id
    }
  }

  return groups[0]?.posts[0]?.id ?? null
}
