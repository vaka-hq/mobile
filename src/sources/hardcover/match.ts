/** A Hardcover search result, reduced to what matching and the picker show. */
export type HardcoverHit = {
  id: number
  title: string
  subtitle: string | null
  authors: string[]
  coverUrl: string | null
  coverColor: string | null
  coverAspect: number | null
  releaseYear: number | null
  series: string | null
  usersCount: number
}

export type MatchCandidate = {
  hit: HardcoverHit
  score: number
}

/** Release noise that AudioBookBay titles carry but book titles do not. */
const releaseNoise =
  /\b(unabridged|abridged|audiobook|audio book|audible|full cast|dramati[sz]ed|mp3|m4b|m4a|aac|flac|\d{2,3}\s?kbps)\b/giu

export function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[’']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The words of a title worth searching for: no brackets, series numbering or release notes. */
export function searchableTitle(value: string) {
  return value
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/gu, ' ')
    .replace(releaseNoise, ' ')
    .replace(/\b(book|volume|vol|part)\.?\s*\d+\b/giu, ' ')
    .replace(/\s+[-:|]\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function tokens(value: string) {
  return new Set(normalize(value).split(' ').filter(Boolean))
}

/** Sørensen–Dice overlap of two word sets, 0 (disjoint) to 1 (identical). */
export function similarity(left: string, right: string) {
  const a = tokens(left)
  const b = tokens(right)

  if (a.size === 0 || b.size === 0) {
    return 0
  }

  let shared = 0

  for (const token of a) {
    if (b.has(token)) {
      shared += 1
    }
  }

  return (2 * shared) / (a.size + b.size)
}

function authorSimilarity(author: string, hit: HardcoverHit) {
  let best = 0

  for (const name of hit.authors) {
    best = Math.max(best, similarity(author, name))
  }

  return best
}

export const matchThreshold = 0.6

/** Scores every hit against the listing's title and author, best first. */
export function rankMatches(hits: HardcoverHit[], title: string, author: string | null) {
  const wanted = searchableTitle(title)

  const candidates = hits.map((hit) => {
    const full = hit.subtitle ? `${hit.title} ${hit.subtitle}` : hit.title
    const titleScore = Math.max(similarity(wanted, hit.title), similarity(wanted, full))

    const score = author ? titleScore * 0.7 + authorSimilarity(author, hit) * 0.3 : titleScore

    return { hit, score } satisfies MatchCandidate
  })

  return candidates.sort(
    (left, right) => right.score - left.score || right.hit.usersCount - left.hit.usersCount,
  )
}

/** The confident match, if any; otherwise the listener chooses in the picker. */
export function bestMatch(hits: HardcoverHit[], title: string, author: string | null) {
  const [best] = rankMatches(hits, title, author)

  return best && best.score >= matchThreshold ? best.hit : null
}

/** What distinguishes one audiobook edition of a book from another. */
export type EditionCandidate = {
  narrators: string[]
  language: string | null
  hasCover: boolean
  usersCount: number
}

/** How well a credit (possibly several names, comma separated) matches a list of names. */
export function creditScore(credit: string, names: string[]) {
  let best = 0

  for (const wanted of credit.split(/,|&|\band\b/u)) {
    for (const name of names) {
      best = Math.max(best, similarity(wanted, name))
    }
  }

  return best
}

/**
 * The audiobook edition matching the recording that was posted: same narrator first, then the
 * post's language, then one with cover art, then the most read. Without a narrator match the
 * book's default audiobook edition is kept, since picking a stranger's recording would mislead.
 */
export function pickEdition<T extends EditionCandidate>(
  editions: T[],
  fallback: T | null,
  narrator: string | null,
  language: string | null,
) {
  if (!narrator) {
    return fallback
  }

  const matching = editions.filter(
    (edition) => creditScore(narrator, edition.narrators) >= matchThreshold,
  )

  if (matching.length === 0) {
    return fallback
  }

  const sameLanguage = (edition: T) =>
    language !== null && edition.language?.toLowerCase() === language.toLowerCase() ? 1 : 0

  return (
    matching.sort(
      (left, right) =>
        sameLanguage(right) - sameLanguage(left) ||
        Number(right.hasCover) - Number(left.hasCover) ||
        right.usersCount - left.usersCount,
    )[0] ?? fallback
  )
}
