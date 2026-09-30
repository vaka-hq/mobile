import type { EbookResult } from './ebooks'
import { compareLanguages } from './languages'

/** Words of a title or name, lowercased without accents or punctuation, for loose matching. */
function words(text: string) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Smaller than this, a file is a stub or a sample rather than the book. */
const minimumBytes = 60 * 1024

function bytesOf(size: string | null) {
  const match = /^([\d.,]+)\s*([kmg]?)b/iu.exec(size ?? '')

  if (!match) {
    return null
  }

  const value = Number((match[1] ?? '').replace(',', '.'))
  const unit = (match[2] ?? '').toLowerCase()

  return value * (unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1)
}

/**
 * Files found for a book, best first: those by its author before any other, then by language, the
 * preferred one first, then English, then the others by name; then those with its title, and
 * those not a stub. Otherwise the sites' own order is kept.
 */
export function rankEbooks(
  results: EbookResult[],
  book: { title: string; authors: string[] },
  preferred: string,
) {
  const surnames = book.authors.map((author) => words(author).at(-1)).filter(Boolean)
  const title = words(book.title).join(' ')
  const byLanguage = compareLanguages(preferred)

  const byAuthor = (result: EbookResult) =>
    surnames.length === 0 ||
    result.authors.some((author) =>
      surnames.some((surname) => words(author).includes(surname ?? '')),
    )

  const withTitle = (result: EbookResult) => words(result.title).join(' ').startsWith(title)

  const score = (result: EbookResult) => {
    const bytes = bytesOf(result.size)

    return (withTitle(result) ? 2 : 0) + (bytes === null || bytes >= minimumBytes ? 1 : 0)
  }

  return results
    .map((result, index) => ({ result, index, author: byAuthor(result), score: score(result) }))
    .sort(
      (a, b) =>
        Number(b.author) - Number(a.author) ||
        byLanguage(a.result.language, b.result.language) ||
        b.score - a.score ||
        a.index - b.index,
    )
    .map(({ result }) => result)
}
