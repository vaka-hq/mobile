import { z } from 'zod'
import { HttpError, request } from '@/lib/http'
import { hardcoverKey } from '@/settings/hardcover-key'
import { type HardcoverHit, pickEdition } from './match'
import { seriesBooks } from './series'

const endpoint = 'https://api.hardcover.app/v1/graphql'

const image = z
  .object({
    url: z.string().nullish(),
    color: z.string().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
  })
  .nullish()

/** A cover's dominant colour and width over height, for placeholders drawn at the final shape. */
function coverStyle(value: z.infer<typeof image>) {
  const color = value?.color && /^#[0-9a-f]{6}$/iu.test(value.color) ? value.color : null
  const aspect = value?.width && value.height ? value.width / value.height : null

  return { coverColor: value?.url ? color : null, coverAspect: value?.url ? aspect : null }
}

const searchDocument = z.object({
  id: z.union([z.string(), z.number()]).transform(Number),
  title: z.string(),
  subtitle: z.string().nullish(),
  author_names: z.array(z.string()).nullish(),
  image: image,
  release_year: z.number().nullish(),
  series_names: z.array(z.string()).nullish(),
  users_count: z.number().nullish(),
})

/** How many matches a search found in all, to tell whether another page follows. */
const found = z.number().nullish()

const searchResults = z.object({
  search: z.object({
    results: z
      .object({ found, hits: z.array(z.object({ document: searchDocument })).nullish() })
      .nullish(),
  }),
})

/** How many results each page of a search in Browse asks for. */
export const searchPageSize = 25

/** Whether a search has results past `page`: by the total found, else by a full page. */
function morePages(total: number | null | undefined, hits: number, page: number, perPage: number) {
  return total === null || total === undefined ? hits === perPage : page * perPage < total
}

/** A search result as the app keeps it; see `HardcoverHit`. */
export const hardcoverHitSchema = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().nullable(),
  authors: z.array(z.string()),
  coverUrl: z.string().nullable(),
  coverColor: z.string().nullable(),
  coverAspect: z.number().nullable(),
  releaseYear: z.number().nullable(),
  series: z.string().nullable(),
  usersCount: z.number(),
}) satisfies z.ZodType<HardcoverHit>

const contribution = z.object({
  contribution: z.string().nullish(),
  author: z.object({ name: z.string() }).nullish(),
})

const edition = z.object({
  id: z.number(),
  title: z.string().nullish(),
  edition_format: z.string().nullish(),
  audio_seconds: z.number().nullish(),
  release_date: z.string().nullish(),
  isbn_13: z.string().nullish(),
  asin: z.string().nullish(),
  users_count: z.number().nullish(),
  cached_image: image,
  publisher: z.object({ name: z.string().nullish() }).nullish(),
  language: z.object({ language: z.string() }).nullish(),
  contributions: z.array(contribution),
})

/** Reader-applied tags, most applied first; an unexpected shape just shows no tags. */
const tagList = z.array(z.object({ tag: z.string() })).catch([])

const cachedTags = z
  .object({
    Genre: tagList.optional(),
    Mood: tagList.optional(),
    'Content Warning': tagList.optional(),
  })
  .nullish()
  .catch(null)

const bookFields = z.object({
  id: z.number(),
  title: z.string().nullish(),
  subtitle: z.string().nullish(),
  headline: z.string().nullish(),
  description: z.string().nullish(),
  release_year: z.number().nullish(),
  slug: z.string().nullish(),
  rating: z.number().nullish(),
  ratings_count: z.number().nullish(),
  pages: z.number().nullish(),
  cached_tags: cachedTags,
  cached_image: image,
  contributions: z.array(contribution),
  book_series: z.array(
    z.object({
      position: z.number().nullish(),
      series: z.object({ id: z.number(), name: z.string() }).nullish(),
    }),
  ),
  default_audio_edition: edition.nullish(),
  editions: z.array(edition),
})

const bookDetails = z.object({ books_by_pk: bookFields.nullish() })

const booksDetails = z.object({ books: z.array(bookFields) })

/** Rich metadata for one Hardcover book, including its default audiobook edition. */
export const hardcoverBookSchema = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().nullable(),
  description: z.string().nullable(),
  releaseYear: z.number().nullable(),
  rating: z.number().nullable(),
  slug: z.string().nullable(),
  coverUrl: z.string().nullable(),
  // Details saved before cover colours were kept have neither field.
  coverColor: z.string().nullable().default(null),
  coverAspect: z.number().nullable().default(null),
  authors: z.array(z.string()),
  narrators: z.array(z.string()),
  // Series saved before their IDs were fetched have none.
  series: z.array(
    z.object({
      id: z.number().nullable().default(null),
      name: z.string(),
      position: z.number().nullable(),
    }),
  ),
  edition: z
    .object({
      id: z.number(),
      title: z.string().nullable(),
      format: z.string().nullable(),
      durationSeconds: z.number().nullable(),
      releaseDate: z.string().nullable(),
      publisher: z.string().nullable(),
      language: z.string().nullable(),
      isbn13: z.string().nullable(),
      asin: z.string().nullable(),
    })
    .nullable(),
})

export type HardcoverBook = z.infer<typeof hardcoverBookSchema>

/** Why Hardcover refused a request, for messages the listener can act on. */
export type HardcoverFailure = 'rejectedKey' | 'missingScope' | 'rateLimited' | 'other'

export class HardcoverError extends HttpError {
  readonly reason: HardcoverFailure

  constructor(message: string, status: number | null, reason: HardcoverFailure = 'other') {
    super(message, status)
    this.name = 'HardcoverError'
    this.reason = reason
  }
}

export class HardcoverNotConnectedError extends Error {
  constructor() {
    super('Add your Hardcover API key in Settings to load book details')
    this.name = 'HardcoverNotConnectedError'
  }
}

const graphqlEnvelope = z.object({
  data: z.json().nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
})

const failure = z.object({
  error: z.string().nullish(),
  error_description: z.string().nullish(),
  scope: z.string().nullish(),
})

function failureFrom(status: number, body: string) {
  let reason: z.infer<typeof failure> | null = null

  try {
    const parsed = failure.safeParse(JSON.parse(body))

    reason = parsed.success ? parsed.data : null
  } catch {
    reason = null
  }

  if (status === 401) {
    return new HardcoverError('Hardcover did not accept the API key', status, 'rejectedKey')
  }

  if (reason?.error === 'insufficient_scope') {
    return new HardcoverError(
      `The Hardcover API key is missing the ${reason.scope ?? 'read:catalog'} permission`,
      status,
      'missingScope',
    )
  }

  if (status === 429) {
    return new HardcoverError('Hardcover’s rate limit was reached', status, 'rateLimited')
  }

  return new HardcoverError(
    reason?.error_description ?? reason?.error ?? `Hardcover answered ${status}`,
    status,
  )
}

async function graphql<T extends z.ZodType>(
  apiKey: string,
  document: string,
  variables: Record<string, string | number | number[]>,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const body = await request(
    endpoint,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Vaka audiobook player (Android)',
      },
      body: JSON.stringify({ query: document, variables }),
      signal,
    },
    async (response) => {
      if (!response.ok) {
        throw failureFrom(response.status, await response.text())
      }

      return graphqlEnvelope.parse(await response.json())
    },
  )

  if (body.errors?.length) {
    throw new HardcoverError(body.errors.map((error) => error.message).join('; '), null)
  }

  return schema.parse(body.data)
}

function query<T extends z.ZodType>(
  document: string,
  variables: Record<string, string | number | number[]>,
  schema: T,
  signal?: AbortSignal,
) {
  const apiKey = hardcoverKey.get()

  if (!apiKey) {
    throw new HardcoverNotConnectedError()
  }

  return graphql(apiKey, document, variables, schema, signal)
}

const accountResult = z.object({
  me: z.array(z.object({ username: z.string().nullish(), email: z.string().nullish() })),
})

/**
 * Who the key belongs to, for Settings. Reading the email needs a `read:me` permission the key
 * may not have, so this falls back to the username and then to nothing rather than failing.
 */
export async function fetchHardcoverAccount(apiKey: string, signal?: AbortSignal) {
  for (const fields of ['username email', 'username']) {
    try {
      const result = await graphql(
        apiKey,
        `query VakaAccount { me { ${fields} } }`,
        {},
        accountResult,
        signal,
      )

      const user = result.me[0]

      if (user) {
        return { email: user.email ?? null, username: user.username ?? null }
      }
    } catch (error) {
      if (error instanceof HardcoverError && error.reason === 'rejectedKey') {
        throw error
      }
    }
  }

  return null
}

/** Checks a key with the smallest catalogue read the app depends on, before it is stored. */
export async function verifyApiKey(apiKey: string, signal?: AbortSignal) {
  await graphql(
    apiKey,
    'query VakaKeyCheck { books(limit: 1) { id } }',
    {},
    z.object({ books: z.array(z.object({ id: z.number() })) }),
    signal,
  )
}

const searchQuery = `
  query VakaSearch($query: String!, $perPage: Int!, $page: Int!) {
    search(query: $query, query_type: "Book", per_page: $perPage, page: $page) {
      results
    }
  }
`

/** The best few books for a search, such as for matching an upload to its book. */
export async function searchBooks(text: string, signal?: AbortSignal): Promise<HardcoverHit[]> {
  return (await searchBookPage(text, 1, 12, signal)).items
}

/** One page of books found by a search, counted from 1, as Browse lists them. */
export function searchBooksPage(text: string, page: number, signal?: AbortSignal) {
  return searchBookPage(text, page, searchPageSize, signal)
}

async function searchBookPage(text: string, page: number, perPage: number, signal?: AbortSignal) {
  const result = await query(searchQuery, { query: text, perPage, page }, searchResults, signal)
  const hits = result.search.results?.hits ?? []

  return {
    items: hits.map(({ document }) => hitFromDocument(document)),
    hasNextPage: morePages(result.search.results?.found, hits.length, page, perPage),
  } satisfies HardcoverBrowsePage
}

function hitFromDocument(document: z.infer<typeof searchDocument>): HardcoverHit {
  return {
    id: document.id,
    title: document.title,
    subtitle: document.subtitle ?? null,
    authors: document.author_names ?? [],
    coverUrl: document.image?.url ?? null,
    ...coverStyle(document.image),
    releaseYear: document.release_year ?? null,
    series: document.series_names?.[0] ?? null,
    usersCount: document.users_count ?? 0,
  }
}

/** What is read of a book, for one or many. */
const bookSelection = `
  id
  title
  subtitle
  headline
  description
  release_year
  slug
  rating
  ratings_count
  pages
  cached_tags
  cached_image
  contributions { contribution author { name } }
  book_series { position series { id name } }
  default_audio_edition {
    id
    title
    edition_format
    audio_seconds
    release_date
    isbn_13
    asin
    users_count
    cached_image
    publisher { name }
    language { language }
    contributions { contribution author { name } }
  }
  editions(where: { reading_format_id: { _eq: 2 } }, order_by: { users_count: desc }, limit: 40) {
    id
    title
    edition_format
    audio_seconds
    release_date
    isbn_13
    asin
    users_count
    cached_image
    publisher { name }
    language { language }
    contributions { contribution author { name } }
  }
`

const bookQuery = `
  query VakaBook($id: Int!) {
    books_by_pk(id: $id) {
      ${bookSelection}
    }
  }
`

function names(contributions: z.infer<typeof contribution>[], role: 'author' | 'narrator') {
  const matches = new Set<string>()

  for (const item of contributions) {
    const kind = item.contribution?.toLowerCase() ?? 'author'

    if (item.author && (role === 'narrator' ? kind === 'narrator' : kind === 'author')) {
      matches.add(item.author.name)
    }
  }

  return [...matches]
}

/** One audiobook recording of a Hardcover book: who reads it, in what language, from whom. */
export const hardcoverRecordingSchema = z.object({
  editionId: z.number(),
  title: z.string().nullable(),
  format: z.string().nullable(),
  narrators: z.array(z.string()),
  language: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  releaseDate: z.string().nullable(),
  publisher: z.string().nullable(),
  coverUrl: z.string().nullable(),
  coverColor: z.string().nullable(),
  coverAspect: z.number().nullable(),
  isbn13: z.string().nullable(),
  asin: z.string().nullable(),
  usersCount: z.number(),
})

export type HardcoverRecording = z.infer<typeof hardcoverRecordingSchema>

/** A Hardcover book with every audiobook recording Hardcover knows of it. */
export const hardcoverWorkSchema = hardcoverBookSchema.omit({ edition: true }).extend({
  recordings: z.array(hardcoverRecordingSchema),
  defaultRecording: hardcoverRecordingSchema.nullable(),
  // Books saved before these were fetched have none of them.
  /** Hardcover's opening line for the description, such as “Six days ago, astronaut…”. */
  headline: z.string().nullable().default(null),
  ratingsCount: z.number().nullable().default(null),
  pages: z.number().nullable().default(null),
  genres: z.array(z.string()).default([]),
  moods: z.array(z.string()).default([]),
  contentWarnings: z.array(z.string()).default([]),
})

export type HardcoverWork = z.infer<typeof hardcoverWorkSchema>

function recordingFrom(item: z.infer<typeof edition>): HardcoverRecording {
  return {
    editionId: item.id,
    title: item.title ?? null,
    format: item.edition_format ?? null,
    narrators: names(item.contributions, 'narrator'),
    language: item.language?.language ?? null,
    durationSeconds: item.audio_seconds ?? null,
    releaseDate: item.release_date ?? null,
    publisher: item.publisher?.name ?? null,
    coverUrl: item.cached_image?.url ?? null,
    ...coverStyle(item.cached_image),
    isbn13: item.isbn_13 ?? null,
    asin: item.asin ?? null,
    usersCount: item.users_count ?? 0,
  }
}

/** The most applied distinct tags, up to `limit`, each starting with a capital as readers mix cases. */
function topTags(tags: z.infer<typeof tagList> | undefined, limit: number) {
  const names = new Set<string>()

  for (const { tag } of tags ?? []) {
    const trimmed = tag.trim()
    const name = trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1)

    if (name) {
      names.add(name)
    }

    if (names.size === limit) {
      break
    }
  }

  return [...names]
}

function workFrom(book: z.infer<typeof bookFields>): HardcoverWork {
  return {
    id: book.id,
    title: book.title ?? '',
    subtitle: book.subtitle ?? null,
    description: book.description?.trim() || null,
    releaseYear: book.release_year ?? null,
    rating: book.rating ?? null,
    slug: book.slug ?? null,
    coverUrl: book.cached_image?.url ?? null,
    ...coverStyle(book.cached_image),
    authors: names(book.contributions, 'author'),
    narrators: names(book.contributions, 'narrator'),
    series: book.book_series.flatMap((entry) =>
      entry.series
        ? [{ id: entry.series.id, name: entry.series.name, position: entry.position ?? null }]
        : [],
    ),
    recordings: book.editions.map(recordingFrom),
    defaultRecording: book.default_audio_edition ? recordingFrom(book.default_audio_edition) : null,
    headline: book.headline?.trim() || null,
    ratingsCount: book.ratings_count ?? null,
    pages: book.pages || null,
    genres: topTags(book.cached_tags?.Genre, 6),
    moods: topTags(book.cached_tags?.Mood, 6),
    contentWarnings: topTags(book.cached_tags?.['Content Warning'], 8),
  }
}

export async function fetchHardcoverWork(id: number, signal?: AbortSignal): Promise<HardcoverWork> {
  const { books_by_pk: book } = await query(bookQuery, { id }, bookDetails, signal)

  if (!book) {
    throw new HardcoverError('Hardcover has no book with this ID', 404)
  }

  return workFrom(book)
}

const booksQuery = `
  query VakaBooks($ids: [Int!]!) {
    books(where: { id: { _in: $ids } }) {
      ${bookSelection}
    }
  }
`

/** Several books in one request; a book Hardcover does not have is left out. */
export async function fetchHardcoverWorks(
  ids: number[],
  signal?: AbortSignal,
): Promise<HardcoverWork[]> {
  const { books } = await query(booksQuery, { ids }, booksDetails, signal)

  return books.map(workFrom)
}

/** What the posted recording is known to be, for choosing the matching audiobook edition. */
export type RecordingHints = {
  narrator: string | null
  language: string | null
}

/** The book as one posted recording presents it: that recording's cover, narrators and facts. */
export function bookForRecording(work: HardcoverWork, hints: RecordingHints): HardcoverBook {
  const candidate = (recording: HardcoverRecording) => ({
    ...recording,
    hasCover: recording.coverUrl !== null,
  })

  const recording = pickEdition(
    work.recordings.map(candidate),
    work.defaultRecording ? candidate(work.defaultRecording) : null,
    hints.narrator,
    hints.language,
  )

  return {
    id: work.id,
    title: work.title || recording?.title || '',
    subtitle: work.subtitle,
    description: work.description,
    releaseYear: work.releaseYear,
    rating: work.rating,
    slug: work.slug,
    ...(recording?.coverUrl
      ? {
          coverUrl: recording.coverUrl,
          coverColor: recording.coverColor,
          coverAspect: recording.coverAspect,
        }
      : { coverUrl: work.coverUrl, coverColor: work.coverColor, coverAspect: work.coverAspect }),
    authors: work.authors,
    narrators: recording?.narrators.length ? recording.narrators : work.narrators,
    series: work.series,
    edition: recording
      ? {
          id: recording.editionId,
          title: recording.title,
          format: recording.format,
          durationSeconds: recording.durationSeconds,
          releaseDate: recording.releaseDate,
          publisher: recording.publisher,
          language: recording.language,
          isbn13: recording.isbn13,
          asin: recording.asin,
        }
      : null,
  }
}

const seriesDocument = z.object({
  id: z.union([z.string(), z.number()]).transform(Number),
  name: z.string(),
  author_name: z.string().nullish(),
  primary_books_count: z.number().nullish(),
  readers_count: z.number().nullish(),
  books: z.array(z.string()).nullish(),
})

const seriesResults = z.object({
  search: z.object({
    results: z
      .object({ found, hits: z.array(z.object({ document: seriesDocument })).nullish() })
      .nullish(),
  }),
})

export const hardcoverSeriesHitSchema = z.object({
  id: z.number(),
  name: z.string(),
  author: z.string().nullable(),
  booksCount: z.number(),
  readersCount: z.number(),
  /** A few titles from the series, to tell same-named series apart. */
  bookTitles: z.array(z.string()),
})

/** One page of series found by a search. */
export const hardcoverSeriesPageSchema = z.object({
  items: z.array(hardcoverSeriesHitSchema),
  hasNextPage: z.boolean(),
})

export type HardcoverSeriesPage = z.infer<typeof hardcoverSeriesPageSchema>

const seriesSearchQuery = `
  query VakaSeriesSearch($query: String!, $perPage: Int!, $page: Int!) {
    search(query: $query, query_type: "Series", per_page: $perPage, page: $page) {
      results
    }
  }
`

/**
 * One page of series matching a search, counted from 1, without the empty ones Hardcover keeps
 * for narrators and imports; a page can so come back short, or empty, with more to follow.
 */
export async function searchSeriesPage(
  text: string,
  page: number,
  signal?: AbortSignal,
): Promise<HardcoverSeriesPage> {
  const result = await query(
    seriesSearchQuery,
    { query: text, perPage: searchPageSize, page },
    seriesResults,
    signal,
  )

  const hits = result.search.results?.hits ?? []

  const items = hits.flatMap(({ document }) =>
    (document.primary_books_count ?? 0) > 0
      ? [
          {
            id: document.id,
            name: document.name,
            author: document.author_name ?? null,
            booksCount: document.primary_books_count ?? 0,
            readersCount: document.readers_count ?? 0,
            bookTitles: (document.books ?? []).slice(0, 3),
          },
        ]
      : [],
  )

  return {
    items,
    hasNextPage: morePages(result.search.results?.found, hits.length, page, searchPageSize),
  }
}

const seriesDetails = z.object({
  series_by_pk: z
    .object({
      id: z.number(),
      name: z.string(),
      author: z.object({ name: z.string() }).nullish(),
      book_series: z.array(
        z.object({
          position: z.number().nullish(),
          compilation: z.boolean().nullish(),
          book: z.object({
            id: z.number(),
            title: z.string().nullish(),
            subtitle: z.string().nullish(),
            release_year: z.number().nullish(),
            users_count: z.number().nullish(),
            compilation: z.boolean().nullish(),
            canonical_id: z.number().nullish(),
            cached_image: image,
            contributions: z.array(contribution),
          }),
        }),
      ),
    })
    .nullish(),
})

const seriesBookSchema = z.object({
  position: z.number(),
  id: z.number(),
  title: z.string(),
  subtitle: z.string().nullable(),
  authors: z.array(z.string()),
  releaseYear: z.number().nullable(),
  coverUrl: z.string().nullable(),
  coverColor: z.string().nullable(),
  coverAspect: z.number().nullable(),
})

export const hardcoverSeriesSchema = z.object({
  id: z.number(),
  name: z.string(),
  author: z.string().nullable(),
  books: z.array(seriesBookSchema),
})

export type HardcoverSeries = z.infer<typeof hardcoverSeriesSchema>

const seriesQuery = `
  query VakaSeries($id: Int!) {
    series_by_pk(id: $id) {
      id
      name
      author { name }
      book_series(where: { position: { _is_null: false } }, order_by: { position: asc }) {
        position
        compilation
        book {
          id
          title
          subtitle
          release_year
          users_count
          compilation
          canonical_id
          cached_image
          contributions { contribution author { name } }
        }
      }
    }
  }
`

export async function fetchHardcoverSeries(
  id: number,
  signal?: AbortSignal,
): Promise<HardcoverSeries> {
  const { series_by_pk: series } = await query(seriesQuery, { id }, seriesDetails, signal)

  if (!series) {
    throw new HardcoverError('Hardcover has no series with this ID', 404)
  }

  const books = seriesBooks(
    series.book_series.map((entry) => ({
      position: entry.position ?? null,
      compilation: Boolean(entry.compilation || entry.book.compilation),
      canonicalId: entry.book.canonical_id ?? null,
      usersCount: entry.book.users_count ?? 0,
      book: entry.book,
    })),
  )

  return {
    id: series.id,
    name: series.name,
    author: series.author?.name ?? null,
    books: books.map(({ position, book }) => ({
      position,
      id: book.id,
      title: book.title ?? '',
      subtitle: book.subtitle ?? null,
      authors: names(book.contributions, 'author'),
      releaseYear: book.release_year ?? null,
      coverUrl: book.cached_image?.url ?? null,
      ...coverStyle(book.cached_image),
    })),
  }
}

const browseBook = z.object({
  id: z.number(),
  title: z.string().nullish(),
  subtitle: z.string().nullish(),
  release_year: z.number().nullish(),
  users_count: z.number().nullish(),
  cached_image: image,
  contributions: z.array(contribution),
  book_series: z.array(z.object({ series: z.object({ name: z.string() }).nullish() })),
})

const browseBookFields = `
  id
  title
  subtitle
  release_year
  users_count
  cached_image
  contributions { contribution author { name } }
  book_series(where: { featured: { _eq: true } }, limit: 1) { series { name } }
`

function hitFromBook(book: z.infer<typeof browseBook>): HardcoverHit {
  return {
    id: book.id,
    title: book.title ?? '',
    subtitle: book.subtitle ?? null,
    authors: names(book.contributions, 'author'),
    coverUrl: book.cached_image?.url ?? null,
    ...coverStyle(book.cached_image),
    releaseYear: book.release_year ?? null,
    series: book.book_series[0]?.series?.name ?? null,
    usersCount: book.users_count ?? 0,
  }
}

/** One page of books to browse, most relevant first. */
export const hardcoverBrowsePageSchema = z.object({
  items: z.array(hardcoverHitSchema),
  hasNextPage: z.boolean(),
})

export type HardcoverBrowsePage = z.infer<typeof hardcoverBrowsePageSchema>

export const browsePageSize = 20

export const hardcoverGenreSchema = z.object({ id: z.number(), name: z.string() })

export type HardcoverGenre = z.infer<typeof hardcoverGenreSchema>

/** Genres that do not describe audiobooks, or say nothing at all. */
const skippedGenres = new Set(['comics', 'comics-graphic-novels', 'general'])

const genreResults = z.object({
  tags: z.array(z.object({ id: z.number(), tag: z.string(), slug: z.string().nullish() })),
})

/** Hardcover's genres, the most used first. */
export async function fetchGenres(signal?: AbortSignal): Promise<HardcoverGenre[]> {
  const result = await query(
    `query VakaGenres {
      tags(where: { tag_category_id: { _eq: 1 } }, order_by: { count: desc }, limit: 24) {
        id
        tag
        slug
      }
    }`,
    {},
    genreResults,
    signal,
  )

  return result.tags
    .filter((tag) => !skippedGenres.has(tag.slug ?? ''))
    .slice(0, 18)
    .map((tag) => ({ id: tag.id, name: tag.tag }))
}

/** Books readers are adding and reading most this month. */
export async function fetchTrending(page: number, signal?: AbortSignal) {
  const trending = await query(
    `query VakaTrending($limit: Int!, $offset: Int!) {
      books_trending(duration: month, limit: $limit, offset: $offset) { ids }
    }`,
    { limit: browsePageSize, offset: page * browsePageSize },
    z.object({ books_trending: z.object({ ids: z.array(z.number()).nullish() }) }),
    signal,
  )

  const ids = trending.books_trending.ids ?? []

  if (ids.length === 0) {
    return { items: [], hasNextPage: false } satisfies HardcoverBrowsePage
  }

  const result = await query(
    `query VakaBooks($ids: [Int!]!) {
      books(where: { id: { _in: $ids } }) { ${browseBookFields} }
    }`,
    { ids },
    z.object({ books: z.array(browseBook) }),
    signal,
  )

  const byId = new Map(result.books.map((book) => [book.id, book]))

  return {
    items: ids.flatMap((id) => {
      const book = byId.get(id)

      return book ? [hitFromBook(book)] : []
    }),
    hasNextPage: ids.length === browsePageSize,
  } satisfies HardcoverBrowsePage
}

/** A genre's books, ordered by how many readers gave them that genre. */
export async function fetchGenreBooks(tagId: number, page: number, signal?: AbortSignal) {
  const result = await query(
    `query VakaGenreBooks($tagId: Int!, $limit: Int!, $offset: Int!) {
      taggable_counts(
        where: { tag_id: { _eq: $tagId }, taggable_type: { _eq: "Book" } }
        order_by: { count: desc }
        limit: $limit
        offset: $offset
      ) {
        book { ${browseBookFields} }
      }
    }`,
    { tagId, limit: browsePageSize, offset: page * browsePageSize },
    z.object({ taggable_counts: z.array(z.object({ book: browseBook.nullish() })) }),
    signal,
  )

  return {
    items: result.taggable_counts.flatMap((entry) => (entry.book ? [hitFromBook(entry.book)] : [])),
    hasNextPage: result.taggable_counts.length === browsePageSize,
  } satisfies HardcoverBrowsePage
}
