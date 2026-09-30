import type { Chapter } from './model'
import { knownPosition } from './timeline'

/**
 * Where listening and reading meet in the same book, without indexing either whole. The
 * audiobook's chapters are paired with the e-book's contents, by title and then by order, and a
 * place is carried over at the same share of its part: twelve minutes into a thirty-minute
 * chapter is 40 % into that chapter's text. Where the parts cannot be paired, the place is carried
 * over at the same share of the whole book, leaving out credits and front matter.
 */

/** An audiobook chapter, from where it starts to where it ends in the whole book, in seconds. */
export type AudioPart = { title: string; start: number; end: number }

/** A part of an e-book as its contents list it, and where it starts, from 0 to 1. */
export type TextPart = { label: string; fraction: number }

/**
 * The audiobook's chapters over the whole book. A chapter is placed when the lengths of the files
 * before it and of its own end are known; files the app could not measure leave out only the
 * chapters that depend on them, not the whole book. Null when no chapter can be placed.
 */
export function audioParts(
  chapters: Chapter[] | null,
  durations: (number | null)[] | null,
): AudioPart[] | null {
  if (!chapters || chapters.length === 0 || !durations) {
    return null
  }

  const parts = chapters.flatMap((chapter, index): AudioPart[] => {
    const start = knownPosition(durations, chapter.track, chapter.start)
    const next = chapters[index + 1]
    const length = durations[chapter.track]

    // A chapter ends where the next one in its file starts, else where its file ends.
    const end =
      next && next.track === chapter.track
        ? knownPosition(durations, next.track, next.start)
        : length === null || length === undefined
          ? null
          : knownPosition(durations, chapter.track, length)

    return start !== null && end !== null && end > start
      ? [{ title: chapter.title, start, end }]
      : []
  })

  return parts.length > 0 ? parts : null
}

/** The e-book's parts in reading order, one per place, with where each ends. */
function textRanges(sections: TextPart[]) {
  const sorted = [...sections]
    .filter((section) => section.fraction >= 0 && section.fraction <= 1)
    .sort((a, b) => a.fraction - b.fraction)
    .filter(
      (section, index, all) => index === 0 || section.fraction > (all[index - 1]?.fraction ?? 0),
    )

  return sorted.map((section, index) => ({
    label: section.label,
    start: section.fraction,
    end: sorted[index + 1]?.fraction ?? 1,
  }))
}

const numberWords = new Map(
  Object.entries({
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    ett: 1,
    en: 1,
    två: 2,
    tre: 3,
    fyra: 4,
    fem: 5,
    sex: 6,
    sju: 7,
    åtta: 8,
    nio: 9,
    tio: 10,
  }),
)

const romanDigits = new Map(Object.entries({ i: 1, v: 5, x: 10, l: 50, c: 100 }))

/** Words that only say what a title is, such as “Chapter” in “Chapter 12”. */
const kindWords = new Set([
  'chapter',
  'chap',
  'ch',
  'kapitel',
  'kap',
  'part',
  'del',
  'book',
  'bok',
  'section',
  'avsnitt',
  'track',
  'spår',
])

function romanValue(token: string) {
  if (!/^[ivxlc]+$/u.test(token)) {
    return null
  }

  let total = 0

  for (let index = 0; index < token.length; index += 1) {
    const value = romanDigits.get(token[index] ?? '') ?? 0
    const next = romanDigits.get(token[index + 1] ?? '') ?? 0

    total += value < next ? -value : value
  }

  return total > 0 ? total : null
}

function tokensOf(title: string) {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** A number a title token stands for: digits, a number word or, after a kind word, a numeral. */
function numberOf(token: string | undefined, afterKind: boolean) {
  if (token === undefined) {
    return null
  }

  if (/^\d+$/u.test(token)) {
    return Number(token)
  }

  return numberWords.get(token) ?? (afterKind ? romanValue(token) : null)
}

/**
 * What a title names, to pair an audio chapter with a part of the text: a chapter number, such as
 * `n:12` for “Chapter 12”, “CHAPTER TWELVE” or “Kapitel XII”, or else its words without the kind.
 */
export function titleKey(title: string) {
  const tokens = tokensOf(title)
  const kind = tokens.findIndex((token) => kindWords.has(token))

  if (kind >= 0) {
    const number = numberOf(tokens[kind + 1], true)

    if (number !== null) {
      return `n:${number}`
    }
  }

  if (tokens.length === 1) {
    const number = numberOf(tokens[0], false)

    if (number !== null) {
      return `n:${number}`
    }
  }

  const words = tokens.filter((token) => !kindWords.has(token) && !/^\d+$/u.test(token))

  return words.join(' ').length >= 3 ? `t:${words.join(' ')}` : null
}

const asidePattern =
  /^(cover|title|title page|half title|halftitle|copyright|contents|table of contents|toc|dedication|epigraph|acknowledg\w*|about the (author|authors|narrator|publisher)|also by .*|praise .*|credits|opening credits|closing credits|end credits|colophon|index|notes|bibliography|glossary|newsletter|sign up .*|front matter|back matter|upplysningar|innehåll|tack)$/u

/** Credits, a cover or a copyright page and the like: parts the other form of the book lacks. */
export function isAside(title: string) {
  return asidePattern.test(tokensOf(title).join(' '))
}

/**
 * For each audio chapter, the e-book part it is, or null. Parts are paired by what their titles
 * name, keeping the book's order; between two pairs, the parts left are paired in order when both
 * sides have as many.
 */
export function pairParts(audio: string[], text: string[]): (number | null)[] {
  const textKeys = text.map(titleKey)
  const pairs: (number | null)[] = audio.map(() => null)
  let last = -1

  audio.forEach((title, index) => {
    const key = titleKey(title)

    if (key === null) {
      return
    }

    const found = textKeys.findIndex((textKey, textIndex) => textIndex > last && textKey === key)

    if (found >= 0) {
      pairs[index] = found
      last = found
    }
  })

  // The stretches between pairs, and before the first and after the last.
  let audioFrom = 0
  let textFrom = 0

  for (let index = 0; index <= audio.length; index += 1) {
    const paired = index < audio.length ? pairs[index] : text.length

    if (paired === null || paired === undefined) {
      continue
    }

    const audioGap = range(audioFrom, index).filter((at) => !isAside(audio[at] ?? ''))
    const textGap = range(textFrom, paired).filter((at) => !isAside(text[at] ?? ''))

    if (audioGap.length === textGap.length) {
      audioGap.forEach((at, order) => {
        pairs[at] = textGap[order] ?? null
      })
    }

    audioFrom = index + 1
    textFrom = paired + 1
  }

  return pairs
}

function range(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index)
}

/** Where the book's own content runs, leaving out asides at either end, as start and end. */
function contentSpan<T>(
  parts: T[],
  title: (part: T) => string,
  start: (part: T) => number,
  end: (part: T) => number,
) {
  const first = parts.findIndex((part) => !isAside(title(part)))
  const lastIndex = parts.findLastIndex((part) => !isAside(title(part)))
  const from = parts[first]
  const to = parts[lastIndex]

  return from && to ? { start: start(from), end: end(to) } : null
}

/** A place carried from listening to reading: how far into the e-book, and the part it is in. */
export type ReadingPlace = { fraction: number; label: string | null }

/** Where to read on from, for a listener `seconds` into the audiobook. */
export function listeningToReading(
  audio: AudioPart[],
  sections: TextPart[],
  seconds: number,
): ReadingPlace | null {
  const text = textRanges(sections)
  const index = audio.findLastIndex((part) => part.start <= seconds)
  const part = audio[Math.max(0, index)]

  if (!part || text.length === 0) {
    return null
  }

  const within = part.end > part.start ? clamp((seconds - part.start) / (part.end - part.start)) : 0

  const paired = pairParts(
    audio.map((each) => each.title),
    text.map((each) => each.label),
  )[Math.max(0, index)]

  const target = paired === null || paired === undefined ? null : text[paired]

  if (target) {
    return { fraction: target.start + within * (target.end - target.start), label: target.label }
  }

  // Unpaired, the place keeps its share of the book's content.
  const heard = contentSpan(
    audio,
    (each) => each.title,
    (each) => each.start,
    (each) => each.end,
  )

  const read = contentSpan(
    text,
    (each) => each.label,
    (each) => each.start,
    (each) => each.end,
  )

  if (!heard || !read || heard.end <= heard.start) {
    return null
  }

  const fraction =
    read.start +
    clamp((seconds - heard.start) / (heard.end - heard.start)) * (read.end - read.start)

  return { fraction, label: text.findLast((each) => each.start <= fraction)?.label ?? null }
}

/** A place carried from reading to listening: seconds into the audiobook, and its chapter. */
export type ListeningPlace = { seconds: number; title: string | null }

/** Where to listen on from, for a reader `fraction` of the way into the e-book. */
export function readingToListening(
  audio: AudioPart[],
  sections: TextPart[],
  fraction: number,
): ListeningPlace | null {
  const text = textRanges(sections)
  const textIndex = text.findLastIndex((each) => each.start <= fraction)
  const part = text[Math.max(0, textIndex)]

  if (!part || audio.length === 0) {
    return null
  }

  const within =
    part.end > part.start ? clamp((fraction - part.start) / (part.end - part.start)) : 0

  const pairs = pairParts(
    audio.map((each) => each.title),
    text.map((each) => each.label),
  )

  const audioIndex = pairs.indexOf(Math.max(0, textIndex))
  const target = audio[audioIndex]

  if (audioIndex >= 0 && target) {
    return { seconds: target.start + within * (target.end - target.start), title: target.title }
  }

  const heard = contentSpan(
    audio,
    (each) => each.title,
    (each) => each.start,
    (each) => each.end,
  )

  const read = contentSpan(
    text,
    (each) => each.label,
    (each) => each.start,
    (each) => each.end,
  )

  if (!heard || !read || read.end <= read.start) {
    return null
  }

  const seconds =
    heard.start +
    clamp((fraction - read.start) / (read.end - read.start)) * (heard.end - heard.start)

  return { seconds, title: audio.findLast((each) => each.start <= seconds)?.title ?? null }
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

/** A word as matched between audio and text: lower case, letters and digits only. */
export function matchWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** A word heard in the audio, with when it starts and ends in the file, in seconds. */
export type HeardWord = { word: string; start: number; end: number }

/**
 * When the first word of `passage` is spoken among `heard`: every run of three words the two share
 * votes for how they line up, and the line-up most runs agree on wins. Null when fewer than two
 * runs agree, since one shared run can be chance.
 */
export function locatePassage(passage: string, heard: HeardWord[]) {
  const written = passage.split(/\s+/u).map(matchWord).filter(Boolean)

  const spoken = heard.flatMap((word) => {
    const matched = matchWord(word.word)

    return matched ? [{ ...word, word: matched }] : []
  })

  if (written.length < 3 || spoken.length < 3) {
    return null
  }

  const runs = new Map<string, number[]>()

  for (let index = 0; index + 2 < written.length; index += 1) {
    const key = `${written[index]} ${written[index + 1]} ${written[index + 2]}`

    runs.set(key, [...(runs.get(key) ?? []), index])
  }

  const votes = new Map<number, number>()

  for (let index = 0; index + 2 < spoken.length; index += 1) {
    const key = `${spoken[index]?.word} ${spoken[index + 1]?.word} ${spoken[index + 2]?.word}`

    for (const at of runs.get(key) ?? []) {
      votes.set(index - at, (votes.get(index - at) ?? 0) + 1)
    }
  }

  const best = [...votes.entries()].reduce<[number, number] | null>(
    (top, entry) => (top === null || entry[1] > top[1] ? entry : top),
    null,
  )

  if (!best || best[1] < 2) {
    return null
  }

  const [shift] = best
  const first = spoken[0]
  const last = spoken[spoken.length - 1]
  const starting = spoken[shift]

  if (starting) {
    return starting.start
  }

  // The passage begins before the stretch heard: step back at the pace of what was heard.
  const pace = first && last && spoken.length > 1 ? (last.end - first.start) / spoken.length : 0.4

  return Math.max(0, (first?.start ?? 0) + shift * pace)
}
