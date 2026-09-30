import { HttpError, readText, type TextReader } from '@/lib/http'
import { type AbbBook, type AbbListingPage, parseBookPage, parseListingPage } from './parse'

export const defaultAudioBookBayUrl = 'https://audiobookbay.lu'

/** A mobile browser identity; the site serves the same markup it gives phones. */
const userAgent =
  'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'

/** What a listing shows: the latest posts, a category or a search. */
export type AbbFeed =
  | { kind: 'latest' }
  | { kind: 'category'; slug: string }
  | { kind: 'search'; query: string }

/** The site's address as the app reaches it: always over HTTPS, which release builds require. */
export function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/u, '')
  const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`)

  return `https://${url.host}`
}

/**
 * Search words as AudioBookBay finds them. Its search misses titles written with punctuation,
 * such as "11/22/63", which posts spell "11-22-63" or "11 22 63", so punctuation becomes spaces;
 * apostrophes stay, as in "Philosopher's".
 */
export function searchTerms(query: string) {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function feedUrl(baseUrl: string, feed: AbbFeed, page: number) {
  const pagePath = page > 1 ? `page/${page}/` : ''

  switch (feed.kind) {
    case 'latest':
      return `${baseUrl}/${pagePath}`
    case 'category':
      return `${baseUrl}/audio-books/type/${encodeURIComponent(feed.slug)}/${pagePath}`
    case 'search': {
      const query = encodeURIComponent(searchTerms(feed.query)).replaceAll('%20', '+')

      return `${baseUrl}/${pagePath}?s=${query}&cat=undefined%2Cundefined`
    }
  }
}

/** Reads a page with `reader`, which is the listener's proxy when one is set up. */
async function fetchPage(url: string, signal: AbortSignal | undefined, reader: TextReader) {
  const response = await reader(url, { Accept: 'text/html', 'User-Agent': userAgent }, signal)

  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(`AudioBookBay answered ${response.status}`, response.status)
  }

  return response.body
}

export async function fetchFeed(
  baseUrl: string,
  feed: AbbFeed,
  page: number,
  signal?: AbortSignal,
  reader: TextReader = readText,
): Promise<AbbListingPage> {
  return parseListingPage(await fetchPage(feedUrl(baseUrl, feed, page), signal, reader))
}

export async function fetchBook(
  baseUrl: string,
  id: string,
  signal?: AbortSignal,
  reader: TextReader = readText,
): Promise<AbbBook> {
  const html = await fetchPage(`${baseUrl}/abss/${encodeURIComponent(id)}/`, signal, reader)

  return parseBookPage(html, id)
}
