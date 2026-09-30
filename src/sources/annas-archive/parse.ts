import { type HTMLElement, parse } from 'node-html-parser'
import { z } from 'zod'

/** One file in an Anna's Archive search, identified by its md5. */
export const annasFileSchema = z.object({
  md5: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  publisher: z.string().nullable(),
  year: z.string().nullable(),
  language: z.string().nullable(),
  extension: z.string().nullable(),
  size: z.string().nullable(),
  coverUrl: z.string().nullable(),
})

export type AnnasFile = z.infer<typeof annasFileSchema>

function clean(text: string | undefined | null) {
  const value = text?.replaceAll(' ', ' ').replace(/\s+/gu, ' ').trim()

  return value ? value : null
}

const md5Path = /^\/md5\/([0-9a-f]{32})/iu

const extensions = /^(epub|pdf|mobi|azw3|fb2|djvu|cbz|cbr|txt|doc|docx|rtf)$/iu

/** The facts line under a result, such as "English [en] · EPUB · 0.5MB · 2021 · 📘 Book". */
function factsOf(card: HTMLElement) {
  const line = card
    .querySelectorAll('div')
    .map((element) => clean(element.text) ?? '')
    .filter((text) => text.includes('·'))
    .sort((a, b) => a.length - b.length)
    .find((text) => text.split('·').some((part) => extensions.test(part.trim())))

  const parts = (line ?? '').split('·').map((part) => part.trim())

  return {
    language: parts[0] && !extensions.test(parts[0]) ? parts[0].replace(/\s*\[\w+\]$/u, '') : null,
    extension: parts.find((part) => extensions.test(part))?.toLowerCase() ?? null,
    size: parts.find((part) => /^\d+(?:[.,]\d+)?\s?[KMG]B$/iu.test(part)) ?? null,
    year: parts.find((part) => /^(1[5-9]|20)\d\d$/u.test(part)) ?? null,
  }
}

/**
 * The files of a signed-in search page. Each result card is found from its title link to
 * `/md5/…`; the card around it holds the author, cover and facts line. A layout the parser does
 * not know yields fewer results rather than wrong ones.
 */
export function parseSearchPage(html: string, baseUrl: string): AnnasFile[] {
  const root = parse(html)
  const seen = new Set<string>()
  const files: AnnasFile[] = []

  for (const link of root.querySelectorAll('a.js-vim-focus')) {
    const md5 = md5Path.exec(link.getAttribute('href') ?? '')?.[1]?.toLowerCase()
    const title = clean(link.text)

    if (!md5 || !title || seen.has(md5)) {
      continue
    }

    seen.add(md5)

    // The card is the largest ancestor that holds this result's title link and no other.
    let scope: HTMLElement = link

    for (let depth = 0; depth < 8; depth += 1) {
      const parent = scope.parentNode

      if (!parent || parent.querySelectorAll('a.js-vim-focus').length > 1) {
        break
      }

      scope = parent
    }

    const author = scope
      .querySelectorAll('span')
      .find((span) => (span.getAttribute('class') ?? '').includes('user-edit'))
      ?.closest('a')

    const cover = scope.querySelector('img')?.getAttribute('src') ?? null

    const publisher = scope
      .querySelectorAll('span')
      .find((span) => (span.getAttribute('class') ?? '').includes('company'))
      ?.closest('a')

    files.push({
      md5,
      title,
      authors: (clean(author?.text) ?? '').split(/[,;]/u).flatMap((name) => clean(name) ?? []),
      publisher: clean(publisher?.text),
      coverUrl: cover ? new URL(cover, `${baseUrl}/`).toString() : null,
      ...factsOf(scope),
    })
  }

  return files
}
