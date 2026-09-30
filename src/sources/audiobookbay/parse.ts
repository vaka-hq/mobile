import { type HTMLElement, parse } from 'node-html-parser'
import { z } from 'zod'
import { UnexpectedAnswerError } from '@/library/errors'

/** One post in an AudioBookBay listing (search, latest or category). */
export const abbListingSchema = z.object({
  /** The post slug from `/abss/<slug>/`, stable across mirrors. */
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  coverUrl: z.string().nullable(),
  categories: z.array(z.string()),
  language: z.string().nullable(),
  format: z.string().nullable(),
  bitrate: z.string().nullable(),
  size: z.string().nullable(),
  postedAt: z.string().nullable(),
})

export type AbbListing = z.infer<typeof abbListingSchema>

export const abbListingPageSchema = z.object({
  items: z.array(abbListingSchema),
  hasNextPage: z.boolean(),
})

export type AbbListingPage = z.infer<typeof abbListingPageSchema>

export const abbFileSchema = z.object({
  name: z.string(),
  size: z.string(),
})

export type AbbFile = z.infer<typeof abbFileSchema>

/** Everything AudioBookBay publishes about one audiobook without signing in. */
/**
 * Raised whenever the book page parser learns to read more, so posts stored by an older version
 * are read again rather than waiting for their daily refresh.
 */
export const abbParserVersion = 3

export const abbBookSchema = z.object({
  /** The parser version that read the post; posts stored before versions existed count as 1. */
  parser: z.number().default(1),
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  narrator: z.string().nullable(),
  coverUrl: z.string().nullable(),
  description: z.array(z.string()),
  categories: z.array(z.string()),
  language: z.string().nullable(),
  format: z.string().nullable(),
  bitrate: z.string().nullable(),
  abridged: z.boolean().nullable(),
  postedAt: z.string().nullable(),
  infoHash: z.string(),
  trackers: z.array(z.string()),
  files: z.array(abbFileSchema),
  totalSize: z.string().nullable(),
})

export type AbbBook = z.infer<typeof abbBookSchema>

const slugPattern = /\/abss\/([^/?#]+)\/?/u

const sizePattern = /^(.*\S)\s+([\d.,]+\s*[KMGT]Bs?)$/iu

export function slugFromUrl(url: string) {
  return slugPattern.exec(url)?.[1] ?? null
}

function clean(text: string | undefined | null) {
  const value = text?.replaceAll('\u00a0', ' ').replace(/\s+/gu, ' ').trim()

  return value ? value : null
}

/** Titles read "Book Title - Author"; the author follows the last separator. */
export function splitTitle(value: string) {
  const title = clean(value) ?? ''
  const separator = title.lastIndexOf(' - ')

  if (separator <= 0) {
    return { title, author: null }
  }

  return { title: title.slice(0, separator).trim(), author: clean(title.slice(separator + 3)) }
}

/** "The Martian (Read by Wil Wheaton) [FIXED]" credits its narrator in the title itself. */
export function narratorFromTitle(title: string) {
  const credit = /\b(?:read|narrated|performed)\s+by\s+([^)\]]+)/iu.exec(title)?.[1]

  return clean(credit?.split(/\s+with\s+/iu)[0])
}

/**
 * A credit line at the start of a description line: "Narrator: Ray Porter", "Narrated by Ray
 * Porter", "Read by: …". Single-word labels need a colon, so "Readers love…" or a review saying
 * "a great narrator" never counts; long values are sentences, not names.
 */
const creditLine =
  /^(?:(?:narrators?|readers?|voiced by)\s*:|(?:narrated|read|performed)\s+by\s*:?)\s*(.+)$/iu

export function narratorFromLines(text: string[]) {
  for (const line of text) {
    const credit = creditLine.exec(line.trim())?.[1]
    const name = clean(credit?.split(/\s+with\s+|[|;]/iu)[0])

    if (name && name.length <= 60) {
      return name
    }
  }

  return null
}

/** Text lines of an element, split where the page uses `<br>` between fields. */
function lines(element: HTMLElement | null | undefined) {
  if (!element) {
    return []
  }

  return parse(element.innerHTML.replace(/<br\s*\/?>/giu, '\n'))
    .text.split('\n')
    .map((line) => line.replaceAll('\u00a0', ' ').trim())
}

/** The value after `Label:` on any line, stopping at the next inline label. */
function labelled(text: string[], label: string) {
  const pattern = new RegExp(`${label}:\\s*(.*?)\\s*(?:[A-Z][a-z]+(?: [A-Z][a-z]+)?:|$)`, 'u')

  for (const line of text) {
    const match = pattern.exec(line)

    if (match) {
      return clean(match[1])
    }
  }

  return null
}

function categoriesFrom(info: HTMLElement | null) {
  if (!info) {
    return []
  }

  const linked = info
    .querySelectorAll('a[rel~="category"]')
    .flatMap((link) => clean(link.text) ?? [])

  if (linked.length > 0) {
    return linked
  }

  const line = parse(info.innerHTML.replace(/<br\s*\/?>/giu, '\n'))
    .text.split('\n')
    .find((text) => text.trim().startsWith('Category:'))

  return (line?.replace('Category:', '') ?? '')
    .split('\u00a0')
    .flatMap((category) => clean(category) ?? [])
}

function languageFrom(info: HTMLElement | null) {
  const tagged = info?.querySelector('[itemprop="inLanguage"]')

  return tagged ? clean(tagged.text) : labelled(lines(info), 'Language')
}

/**
 * A cover's address as the app can load it: release builds refuse plain HTTP, so an `http:` or
 * scheme-relative address is asked for over HTTPS, and a path on the site itself, usually its
 * placeholder cover, is left out.
 */
function coverAddress(src: string | undefined) {
  const value = src?.trim()

  if (!value) {
    return null
  }

  if (value.startsWith('//')) {
    return `https:${value}`
  }

  if (/^http:\/\//iu.test(value)) {
    return `https://${value.slice('http://'.length)}`
  }

  return /^https:\/\//iu.test(value) ? value : null
}

function parseListing(post: HTMLElement): AbbListing | null {
  const link = post.querySelector('.postTitle a')
  const id = slugFromUrl(link?.getAttribute('href') ?? '')

  if (!link || !id) {
    return null
  }

  const { title, author } = splitTitle(link.text)
  const info = post.querySelector('.postInfo')
  const details = lines(post.querySelector('.postContent'))

  return {
    id,
    title,
    author,
    coverUrl: coverAddress(post.querySelector('.postContent img')?.getAttribute('src')),
    categories: categoriesFrom(info),
    language: languageFrom(info),
    format: clean(labelled(details, 'Format')?.split('/')[0]),
    bitrate: labelled(details, 'Bitrate'),
    size: labelled(details, 'File Size'),
    postedAt: labelled(details, 'Posted'),
  }
}

export function parseListingPage(html: string): AbbListingPage {
  const root = parse(html)
  const items: AbbListing[] = []

  for (const post of root.querySelectorAll('div.post')) {
    const listing = parseListing(post)

    if (listing) {
      items.push(listing)
    }
  }

  const pagination = root.querySelector('.wp-pagenavi')
  const current = Number(pagination?.querySelector('.current')?.text ?? '1')

  const hasNextPage =
    pagination
      ?.querySelectorAll('a')
      .some((link) => Number(clean(link.text)) === current + 1 || link.text.includes('»')) ?? false

  return { items, hasNextPage }
}

function tableRows(root: HTMLElement) {
  return root
    .querySelectorAll('.postContent table tr')
    .map((row) => row.querySelectorAll('td').map((cell) => clean(cell.text) ?? ''))
}

export function parseBookPage(html: string, id: string): AbbBook {
  const root = parse(html)
  const post = root.querySelector('div.post')

  if (!post) {
    throw new UnexpectedAnswerError('AudioBookBay returned a page without an audiobook')
  }

  const heading = splitTitle(post.querySelector('.postTitle h1')?.text ?? '')
  const info = post.querySelector('.postInfo')
  // Newer posts keep the credits and blurb in a .desc block. Older ones have none: a credits
  // paragraph and the blurb's paragraphs sit straight in the post body.
  const description = post.querySelector('.desc')
  const body = description ?? post.querySelector('.postContent')
  const rows = tableRows(post)
  const trackers = new Set<string>()
  const files: AbbFile[] = []
  let infoHash: string | null = null
  let totalSize: string | null = null

  for (const [label = '', value = ''] of rows) {
    if (/^(Announce URL|Tracker):$/iu.test(label) && value) {
      trackers.add(value)
    } else if (/^Info Hash:$/iu.test(label)) {
      infoHash = value.toLowerCase()
    } else if (/^Combined File Size:$/iu.test(label)) {
      totalSize = value
    } else if (value === '' && sizePattern.test(label) && !/torrent/iu.test(label)) {
      const [, name = label, size = ''] = sizePattern.exec(label) ?? []

      files.push({ name, size })
    }
  }

  if (!infoHash || !/^[0-9a-f]{40}$/u.test(infoHash)) {
    throw new UnexpectedAnswerError('AudioBookBay did not publish an info hash for this audiobook')
  }

  const summary = description
    ? description.querySelector('p')
    : (body?.querySelector('p[itemprop="description"]') ?? null)

  const summaryText = summary?.text.replaceAll('\u00a0', ' ') ?? ''
  const summaryLines = lines(summary)

  // The body of an older post also holds the uploader and cover paragraphs, which are centred.
  const blurb = (body?.querySelectorAll('p') ?? []).filter(
    (paragraph) =>
      description || (!paragraph.closest('.center') && !paragraph.classList.contains('center')),
  )

  const paragraphs = blurb.flatMap((paragraph) =>
    paragraph === summary && (!description || /Written by|Read by/iu.test(summaryText))
      ? []
      : (clean(paragraph.text) ?? []),
  )

  const abridged =
    clean(post.querySelector('.is_abridged')?.text) ??
    summaryLines.find((line) => /^(?:un)?abridged$/iu.test(line)) ??
    null

  return {
    parser: abbParserVersion,
    id,
    title: heading.title,
    author: clean(post.querySelector('.author')?.text) ?? heading.author,
    narrator:
      clean(post.querySelector('.narrator')?.text) ??
      labelled(summaryLines, 'Read by') ??
      narratorFromLines(blurb.flatMap((paragraph) => lines(paragraph))) ??
      narratorFromTitle(heading.title),
    coverUrl: coverAddress(post.querySelector('.postContent img')?.getAttribute('src')),
    description: paragraphs,
    categories: categoriesFrom(info),
    language: languageFrom(info),
    format: clean(post.querySelector('.format')?.text) ?? labelled(summaryLines, 'Format'),
    bitrate: clean(post.querySelector('.bitrate')?.text) ?? labelled(summaryLines, 'Bitrate'),
    abridged: abridged ? /^abridged$/iu.test(abridged) : null,
    postedAt: post.querySelector('meta[itemprop="datePublished"]')?.getAttribute('content') ?? null,
    infoHash,
    trackers: [...trackers],
    files,
    totalSize,
  }
}

export function magnetLink(book: Pick<AbbBook, 'infoHash' | 'title' | 'trackers'>) {
  const parameters = [`xt=urn:btih:${book.infoHash}`, `dn=${encodeURIComponent(book.title)}`]

  for (const tracker of book.trackers) {
    parameters.push(`tr=${encodeURIComponent(tracker)}`)
  }

  return `magnet:?${parameters.join('&')}`
}
