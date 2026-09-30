import { z } from 'zod'
import { HttpError, request } from '@/lib/http'
import { type AnnasFile, parseSearchPage } from './parse'

/** The mirror in use when the listener has not chosen one; Anna's Archive moves domains often. */
export const defaultAnnasArchiveUrl = 'https://annas-archive.gl'

const userAgent =
  'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'

/** The rejection of a secret key, as opposed to the site being unreachable. */
export class AnnasKeyError extends Error {
  constructor() {
    super('Anna’s Archive did not accept this secret key')
    this.name = 'AnnasKeyError'
  }
}

/** A refusal the members' API put into words, such as a file it does not have. */
class AnnasRefusal extends HttpError {}

const fastDownload = z.object({
  download_url: z.string().nullable(),
  error: z.string().nullish(),
})

/**
 * A direct, short-lived download link for a file, through the members' API. The API answers
 * outside the site's browser check, so it works from the app.
 */
export async function annasDownload(
  baseUrl: string,
  key: string,
  md5: string,
  signal?: AbortSignal,
) {
  const url = `${baseUrl}/dyn/api/fast_download.json?${new URLSearchParams({ md5, key }).toString()}`

  const { status, body } = await request(
    url,
    { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal },
    async (response) => ({
      status: response.status,
      body: await response.json().catch(() => null),
    }),
  )

  const parsed = fastDownload.safeParse(body)

  if (!parsed.success) {
    throw new HttpError(`Anna’s Archive answered ${status}`, status)
  }

  if (parsed.data.error === 'Invalid secret key' || status === 401 || status === 403) {
    throw new AnnasKeyError()
  }

  if (!parsed.data.download_url) {
    throw new AnnasRefusal(parsed.data.error ?? `Anna’s Archive answered ${status}`, status)
  }

  return { url: parsed.data.download_url }
}

/**
 * Checks a secret key without spending a download: an md5 that matches nothing is refused for a
 * bad key before the file is looked up.
 */
export async function verifyAnnasKey(baseUrl: string, key: string, signal?: AbortSignal) {
  try {
    await annasDownload(baseUrl, key, '0'.repeat(32), signal)
  } catch (error) {
    // The API refusing the file in its own words means it accepted the key; anything else, such
    // as a page from a mirror that is down, says nothing about the key.
    if (error instanceof AnnasRefusal) {
      return
    }

    throw error
  }
}

/**
 * Signs in with the secret key. Searching is behind a browser check that an app cannot pass,
 * and a member's session skips it; the session cookie is kept by the phone's cookie store.
 */
export async function signInToAnnas(baseUrl: string, key: string, signal?: AbortSignal) {
  const status = await request(
    `${baseUrl}/account/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
        Referer: `${baseUrl}/account/`,
      },
      body: new URLSearchParams({ key }).toString(),
      signal,
    },
    async (response) => response.status,
  )

  if (status >= 400) {
    throw new HttpError(`Anna’s Archive answered ${status}`, status)
  }
}

/** A page this full may have another after it, when the page does not link to the next. */
const fullPage = 50

/**
 * One page of e-books matching `query`, counted from 1, from a signed-in session, and whether
 * another follows: the page links to it, or came back full.
 */
export async function searchAnnas(
  baseUrl: string,
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<{ files: AnnasFile[]; hasNextPage: boolean }> {
  const params = new URLSearchParams({
    q: query,
    ext: 'epub',
    content: 'book_any',
    page: String(page),
  })

  const { status, body } = await request(
    `${baseUrl}/search?${params.toString()}`,
    { headers: { Accept: 'text/html', 'User-Agent': userAgent }, signal },
    async (response) => ({ status: response.status, body: await response.text() }),
  )

  if (status < 200 || status >= 300) {
    throw new HttpError(`Anna’s Archive answered ${status}`, status)
  }

  const files = parseSearchPage(body, baseUrl)

  return {
    files,
    hasNextPage: files.length > 0 && (linksToPage(body, page + 1) || files.length >= fullPage),
  }
}

/** Whether a results page links to page `number`, as its page numbers do. */
function linksToPage(html: string, number: number) {
  return new RegExp(`[?&;]page=${number}(?!\\d)`, 'u').test(html)
}
