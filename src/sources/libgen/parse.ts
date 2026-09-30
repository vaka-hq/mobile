import { type HTMLElement, parse } from 'node-html-parser'
import { z } from 'zod'

/** One file in a Library Genesis search, identified by its md5 as every mirror is. */
export const libgenFileSchema = z.object({
  md5: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  publisher: z.string().nullable(),
  year: z.string().nullable(),
  language: z.string().nullable(),
  extension: z.string().nullable(),
  /** As the site writes it, such as "514 kB". */
  size: z.string().nullable(),
  isbns: z.array(z.string()),
})

export type LibgenFile = z.infer<typeof libgenFileSchema>

function clean(text: string | undefined | null) {
  const value = text?.replaceAll(' ', ' ').replace(/\s+/gu, ' ').trim()

  return value ? value : null
}

const md5Pattern = /md5=([0-9a-f]{32})/iu

/** A row's cells, each parsed alone, since misnested tags in one otherwise swallow the next. */
function cellsOf(row: string) {
  return row
    .split(/<td[\s>]/u)
    .slice(1)
    .map((cell) => parse(`<div>${cell.replace(/<\/td>[\s\S]*$/u, '')}</div>`))
}

function fileFrom(cells: HTMLElement[]): LibgenFile | null {
  // The full table has nine cells: title, authors, publisher, year, language, pages, size,
  // extension and mirrors. A compact layout has five; both keep the mirrors last.
  if (cells.length < 5) {
    return null
  }

  const mirrors = cells[cells.length - 1]

  const md5 = mirrors
    ?.querySelectorAll('a')
    .map((link) => md5Pattern.exec(link.getAttribute('href') ?? '')?.[1])
    .find(Boolean)

  const titleCell = cells[0]

  if (!md5 || !titleCell) {
    return null
  }

  const title = clean(titleCell.querySelector('a')?.text)

  const isbns = (clean(titleCell.querySelector('font')?.text) ?? '')
    .split(';')
    .flatMap((isbn) => clean(isbn.replaceAll('-', '')) ?? [])

  const full = cells.length >= 9
  const text = (index: number) => clean(cells[index]?.text)

  return {
    md5: md5.toLowerCase(),
    title: title ?? '',
    authors: (text(1) ?? '').split(/[,;]/u).flatMap((author) => clean(author) ?? []),
    publisher: full ? text(2) : null,
    year: full ? text(3) : null,
    language: full ? text(4) : null,
    size: full ? text(6) : null,
    extension: full ? (text(7)?.toLowerCase() ?? null) : null,
    isbns,
  }
}

/** The files of a search result page, in the site's order. */
export function parseSearchPage(html: string): LibgenFile[] {
  // The results table is cut out and read row by row and cell by cell: the page's scripts, the
  // markup inside tooltip titles and misnested tags leave the parser lost on the whole page.
  const start = html.indexOf('id="tablelibgen"')
  const end = html.indexOf('</table>', start)

  if (start < 0 || end < 0) {
    return []
  }

  return html
    .slice(start, end)
    .replaceAll('""', '"')
    .replaceAll(/\stitle="[^"]*"/gu, '')
    .split(/<tr[\s>]/u)
    .slice(1)
    .flatMap((row) => fileFrom(cellsOf(row)) ?? [])
}

/**
 * How many pages a search has in all, from the script that draws its page numbers,
 * `new Paginator(id, pages, shown, current, url)`; null when the page has none.
 */
export function parsePageCount(html: string) {
  const match = /new Paginator\(\s*"[^"]*"\s*,\s*(\d+)\s*,/u.exec(html)

  return match?.[1] ? Number(match[1]) : null
}

/** The keyed download link and the cover on a file's mirror page, relative to the mirror. */
export function parseMirrorPage(html: string) {
  const root = parse(html)

  const link = root
    .querySelectorAll('a')
    .map((anchor) => anchor.getAttribute('href') ?? '')
    .find((href) => /get\.php\?md5=/u.test(href))

  const cover = root
    .querySelectorAll('img')
    .map((image) => image.getAttribute('src') ?? '')
    .find((src) => /covers\//u.test(src))

  return { download: link?.replaceAll('&amp;', '&') ?? null, cover: cover ?? null }
}
