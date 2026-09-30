import { HttpError, readText } from '@/lib/http'
import { type LibgenFile, parseMirrorPage, parsePageCount, parseSearchPage } from './parse'

export const defaultLibgenUrl = 'https://libgen.li'

/**
 * A mobile browser identity: the mirrors answer unknown clients with a blank server page, and
 * their mirror pages only with a Referer from the site itself.
 */
const userAgent =
  'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'

export function libgenHeaders(baseUrl: string) {
  return { Accept: 'text/html', 'User-Agent': userAgent, Referer: `${baseUrl}/` }
}

async function page(url: string, baseUrl: string, signal?: AbortSignal) {
  const response = await readText(url, libgenHeaders(baseUrl), signal)

  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(`Library Genesis answered ${response.status}`, response.status)
  }

  return response.body
}

/** How many results a search page asks for. */
const searchPageSize = 50

/**
 * One page of files matching `query` by title or author among books and fiction, counted from 1,
 * and whether another follows: by the search's page count, else by a full page.
 */
export async function searchLibgen(
  baseUrl: string,
  query: string,
  pageNumber: number,
  signal?: AbortSignal,
): Promise<{ files: LibgenFile[]; hasNextPage: boolean }> {
  const params = new URLSearchParams([
    ['req', query],
    ['columns[]', 't'],
    ['columns[]', 'a'],
    ['columns[]', 'i'],
    ['objects[]', 'f'],
    ['topics[]', 'l'],
    ['topics[]', 'f'],
    ['res', String(searchPageSize)],
    ['filesuns', 'all'],
    ['page', String(pageNumber)],
  ])

  const html = await page(`${baseUrl}/index.php?${params.toString()}`, baseUrl, signal)
  const files = parseSearchPage(html)
  const pages = parsePageCount(html)

  return {
    files,
    hasNextPage:
      files.length > 0 && (pages === null ? files.length >= searchPageSize : pageNumber < pages),
  }
}

/**
 * A file's direct download link and cover. The link is keyed per request and short-lived, so it
 * is asked for just before downloading.
 */
export async function libgenDownload(baseUrl: string, md5: string, signal?: AbortSignal) {
  const mirror = parseMirrorPage(
    await page(`${baseUrl}/ads.php?md5=${encodeURIComponent(md5)}`, baseUrl, signal),
  )

  if (!mirror.download) {
    throw new HttpError('Library Genesis has no download for this book', null)
  }

  const absolute = (path: string) => new URL(path, `${baseUrl}/`).toString()

  return {
    url: absolute(mirror.download),
    coverUrl: mirror.cover ? absolute(mirror.cover) : null,
  }
}
