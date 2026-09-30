import type { BookRecord, LibraryEntry } from './model'
import { bookDuration } from './timeline'

/** Presentation prefers Hardcover's curated metadata and falls back to AudioBookBay's post. */
/**
 * Hardcover titles sometimes already end with the subtitle ("Atomic Habits: An Easy & Proven
 * Way…"); show the short title with the subtitle beneath it instead of repeating it.
 */
export function splitTitle(title: string, subtitle: string | null) {
  const trimmed = subtitle?.trim()

  if (!trimmed) {
    return { title, subtitle: null }
  }

  const lowerTitle = title.toLowerCase()
  const lowerSubtitle = trimmed.toLowerCase()

  if (lowerTitle === lowerSubtitle) {
    return { title, subtitle: null }
  }

  if (lowerTitle.endsWith(lowerSubtitle)) {
    const short = title.slice(0, title.length - trimmed.length).replace(/[\s:–—-]+$/u, '')

    return short ? { title: short, subtitle: trimmed } : { title, subtitle: null }
  }

  return { title, subtitle: trimmed }
}

export function displayTitle(book: BookRecord) {
  const title = book.hardcover?.title || book.abb.title

  return splitTitle(title, book.hardcover?.subtitle ?? null).title
}

export function displaySubtitle(book: BookRecord) {
  if (!book.hardcover?.title) {
    return null
  }

  return splitTitle(book.hardcover.title, book.hardcover.subtitle).subtitle
}

export function displayAuthors(book: BookRecord) {
  if (book.hardcover && book.hardcover.authors.length > 0) {
    return book.hardcover.authors
  }

  return book.abb.author ? [book.abb.author] : []
}

export function displayNarrators(book: BookRecord) {
  if (book.hardcover && book.hardcover.narrators.length > 0) {
    return book.hardcover.narrators
  }

  return book.abb.narrator ? [book.abb.narrator] : []
}

export function displayCover(book: BookRecord) {
  return book.hardcover?.coverUrl ?? book.abb.coverUrl
}

/** The cover with Hardcover's colour and proportions when the image is Hardcover's. */
export function displayCoverArt(book: BookRecord) {
  const hardcover = book.hardcover?.coverUrl ? book.hardcover : null

  return {
    uri: displayCover(book),
    color: hardcover?.coverColor ?? null,
    aspect: hardcover?.coverAspect ?? null,
  }
}

export function displayDescription(book: BookRecord) {
  return book.hardcover?.description ?? (book.abb.description.join('\n\n') || null)
}

export function displaySeries(book: BookRecord) {
  return book.hardcover?.series[0] ?? null
}

/** The measured length, else Hardcover's edition length. */
export function displayDuration(book: BookRecord) {
  return bookDuration(book.durations) ?? book.hardcover?.edition?.durationSeconds ?? null
}

/** A library book as it shows: its stream's details when it has one, else Hardcover's book. */
export function displayEntry(entry: LibraryEntry) {
  const work = entry.work.work
  // The year the book came out, as the book pages show it after the author.
  const year = work?.releaseYear ?? entry.book?.hardcover?.releaseYear ?? null

  if (entry.book) {
    return {
      title: displayTitle(entry.book),
      authors: displayAuthors(entry.book),
      year,
      cover: displayCoverArt(entry.book),
    }
  }

  return {
    title: work ? splitTitle(work.title, work.subtitle).title : '',
    authors: work?.authors ?? [],
    year,
    cover: {
      uri: work?.coverUrl ?? null,
      color: work?.coverColor ?? null,
      aspect: work?.coverAspect ?? null,
    },
  }
}
