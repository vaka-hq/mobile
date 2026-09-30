import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { type ReactNode, useEffect, useState } from 'react'
import { EbookResultRow, useOpenEbook } from '@/components/ebook-row'
import { SeriesSheet } from '@/components/series-sheet'
import { fillMaxSize } from '@/lib/compose-modifiers'
import { LazyColumn } from '@/lib/compose-ui'
import { NetworkError } from '@/lib/http'
import { ProxyAuthError } from '@/lib/proxied-http'
import { AbbSilentError } from '@/library/abb-reader'
import type { HardcoverBrowse } from '@/library/catalog'
import { splitTitle } from '@/library/display'
import { byPreferredLanguage } from '@/library/languages'
import {
  useEbookSearchPages,
  useFeed,
  useHardcoverBrowse,
  useHardcoverGenres,
  useHardcoverSearchPages,
  useHardcoverSeriesSearch,
} from '@/library/queries'
import { useHardcoverKey } from '@/settings/hardcover-key'
import { usePreferences } from '@/settings/preferences'
import { type AbbCategorySlug, abbCategories } from '@/sources/audiobookbay/categories'
import type { AbbFeed } from '@/sources/audiobookbay/client'
import type { AbbListing } from '@/sources/audiobookbay/parse'
import { useErrorText } from '@/ui/errors'
import { useLabels } from '@/ui/labels'
import {
  BookRow,
  CardRow,
  ChipRow,
  Empty,
  LoadMore,
  LoadingPage,
  Notice,
  SearchField,
} from '@/ui/primitives'
import { Screen } from '@/ui/screen'

const latestKey = 'latest'

const sourceKeys = ['books', 'series', 'uploads', 'ebooks'] as const

type Source = (typeof sourceKeys)[number]

function isSource(key: string): key is Source {
  return sourceKeys.some((source) => source === key)
}

function useDebounced(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs)

    return () => clearTimeout(timeout)
  }, [value, delayMs])

  return debounced
}

function listingDetail(listing: AbbListing) {
  return [listing.format, listing.size, listing.language].filter(Boolean).join(' · ')
}

/** Each item once, the first time it was found, as later pages can repeat what came before. */
function uniqueBy<T>(items: T[], key: (item: T) => string | number) {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

/** What a list of results needs to know of the paged request behind it. */
type PagedResults = {
  /** Nothing to show yet, not even the last search's results. */
  isPending: boolean
  /** The first page failed, so there is nothing to show. */
  isLoadingError: boolean
  error: Error | null
  hasNextPage: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => void
}

/**
 * Results that load page by page as the list reaches its end. Loading, a failure and finding
 * nothing each fill the whole body, centred; a later page failing says so at the list's foot.
 */
function PagedList({
  results,
  count,
  failed,
  empty,
  children,
}: {
  results: PagedResults
  count: number
  failed: ReactNode
  empty: ReactNode
  children: ReactNode
}) {
  const { t } = useLingui()
  const errorText = useErrorText()

  if (results.isLoadingError) {
    return failed
  }

  if (results.isPending) {
    return <LoadingPage />
  }

  // A page can come back empty with more to follow, as series searches leave empty series out.
  if (count === 0 && !results.hasNextPage) {
    return empty
  }

  return (
    // The spinner at the foot brings its own room above and below it, so the list adds none and
    // it sits midway between the last result and the bar below.
    <LazyColumn
      modifiers={[fillMaxSize()]}
      contentPadding={{ bottom: results.hasNextPage && !results.isFetchNextPageError ? 0 : 16 }}
    >
      {children}
      {results.isFetchNextPageError ? (
        <Notice
          glyph='warning'
          tone='error'
          message={errorText(results.error)}
          actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
          onAction={() => results.fetchNextPage()}
        />
      ) : results.hasNextPage ? (
        <LoadMore
          loading={results.isFetchingNextPage}
          // Not while the list itself refreshes; the next page is asked for once it is done.
          onVisible={() => {
            if (!results.isFetchingNextPage && !results.isFetching) {
              results.fetchNextPage()
            }
          }}
        />
      ) : null}
    </LazyColumn>
  )
}

/** A failed first page, filling the body, with the way to try again. */
function Failed({
  title,
  message,
  offline = false,
  onRetry,
}: {
  title: string
  message: string
  offline?: boolean
  onRetry: () => void
}) {
  const { t } = useLingui()

  return (
    <Empty
      glyph={offline ? 'offline' : 'warning'}
      height='fill'
      title={title}
      message={message}
      actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
      onAction={onRetry}
    />
  )
}

/** Books and series found on Hardcover; a book opens its uploads, a series its books. */
function HardcoverResults({
  query,
  source,
  onSearchUploads,
}: {
  query: string
  source: 'books' | 'series'
  onSearchUploads: () => void
}) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const labels = useLabels()
  const books = useHardcoverSearchPages(query, source === 'books')
  const series = useHardcoverSeriesSearch(query, source === 'series')
  const results = source === 'books' ? books : series

  const bookHits = uniqueBy(books.data?.pages.flatMap((page) => page.items) ?? [], (hit) => hit.id)

  const seriesHits = uniqueBy(
    series.data?.pages.flatMap((page) => page.items) ?? [],
    (hit) => hit.id,
  )

  // A series opens in the same sheet as from a book's page, over the results.
  const [openSeries, setOpenSeries] = useState<number | null>(null)

  return (
    <>
      <PagedList
        results={results}
        count={source === 'books' ? bookHits.length : seriesHits.length}
        failed={
          <Failed
            offline={results.error instanceof NetworkError}
            title={t({
              message: 'Hardcover couldn’t be searched',
              comment: 'Title when searching Hardcover for books or series failed',
            })}
            message={errorText(results.error)}
            onRetry={() => void results.refetch()}
          />
        }
        empty={
          <Empty
            glyph='search'
            height='fill'
            title={
              source === 'books'
                ? t({ message: 'No books found on Hardcover', comment: 'Empty Hardcover search' })
                : t({
                    message: 'No series found on Hardcover',
                    comment: 'Empty Hardcover series search',
                  })
            }
            message={t({
              message: 'Try the audiobook uploads for books Hardcover does not list.',
              comment: 'Hint under an empty Hardcover search',
            })}
            actionLabel={t({
              message: 'Search audiobooks',
              comment: 'Switches the search to audiobook uploads',
            })}
            onAction={onSearchUploads}
          />
        }
      >
        {source === 'books'
          ? bookHits.map((hit, index) => (
              <BookRow
                key={hit.id}
                card={{ index, count: bookHits.length }}
                title={splitTitle(hit.title, hit.subtitle).title}
                subtitle={labels.authors(hit.authors)}
                detail={[hit.series, hit.releaseYear].filter(Boolean).join(' · ')}
                coverUri={hit.coverUrl}
                coverColor={hit.coverColor}
                coverAspect={hit.coverAspect}
                onPress={() => router.push(`/work/${hit.id}`)}
              />
            ))
          : seriesHits.map(({ booksCount, ...hit }, index) => (
              <CardRow
                key={hit.id}
                card={{ index, count: seriesHits.length }}
                title={hit.name}
                subtitle={[
                  hit.author,
                  t({
                    message: plural(booksCount, { one: '# book', other: '# books' }),
                    comment: 'Number of books in a series, in search results',
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                detail={hit.bookTitles.join(', ')}
                onPress={() => setOpenSeries(hit.id)}
              />
            ))}
      </PagedList>
      {openSeries !== null ? (
        <SeriesSheet seriesId={openSeries} onDismiss={() => setOpenSeries(null)} />
      ) : null}
    </>
  )
}

/** EPUBs to read, from the e-book sites; tapping one downloads it and opens it. */
function EbookResults({ query }: { query: string }) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const results = useEbookSearchPages(query)
  const { preferredLanguage } = usePreferences()

  // Each page in the preferred language first, then English, so what is shown never reorders as
  // more pages come in.
  const hits = uniqueBy(
    results.data?.pages.flatMap((page) => byPreferredLanguage(page.items, preferredLanguage)) ?? [],
    (hit) => hit.md5,
  )

  const openEbook = useOpenEbook()

  return (
    <PagedList
      results={results}
      count={hits.length}
      failed={
        <Failed
          offline={results.error instanceof NetworkError}
          title={t({
            message: 'E-books couldn’t be searched',
            comment: 'Title when searching the e-book sites failed',
          })}
          message={errorText(
            results.error,
            t({
              message: 'Try again in a moment.',
              comment: 'Hint under a failed e-book search',
            }),
          )}
          onRetry={() => void results.refetch()}
        />
      }
      empty={
        <Empty
          glyph='read'
          height='fill'
          title={t({ message: 'No e-books found', comment: 'No EPUB files were found for a book' })}
          message={t({
            message: 'Try the title or the author’s name on its own.',
            comment: 'Empty search results hint',
          })}
        />
      }
    >
      {hits.map((hit, index) => (
        <EbookResultRow
          key={hit.md5}
          result={hit}
          card={{ index, count: hits.length }}
          onPress={() => openEbook(hit)}
        />
      ))}
    </PagedList>
  )
}

const trendingKey = 'trending'

function browseFor(key: string): HardcoverBrowse {
  const tagId = key.startsWith('genre:') ? Number(key.slice('genre:'.length)) : Number.NaN

  return Number.isInteger(tagId) ? { kind: 'genre', tagId } : { kind: 'trending' }
}

/** Hardcover's trending books or a genre's most tagged, before anything is searched. */
function HardcoverBrowseList({ browse }: { browse: HardcoverBrowse }) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const labels = useLabels()
  const results = useHardcoverBrowse(browse, true)
  const unique = uniqueBy(results.data?.pages.flatMap((page) => page.items) ?? [], (hit) => hit.id)

  return (
    <PagedList
      results={results}
      count={unique.length}
      failed={
        <Failed
          offline={results.error instanceof NetworkError}
          title={t({
            message: 'Hardcover couldn’t be reached',
            comment: 'Title when loading books to browse from Hardcover failed',
          })}
          message={errorText(results.error)}
          onRetry={() => void results.refetch()}
        />
      }
      empty={
        <Empty
          glyph='search'
          height='fill'
          title={t({ message: 'No books here yet', comment: 'Empty Hardcover browse list' })}
        />
      }
    >
      {unique.map((hit, index) => (
        <BookRow
          key={hit.id}
          card={{ index, count: unique.length }}
          title={splitTitle(hit.title, hit.subtitle).title}
          subtitle={labels.authors(hit.authors)}
          detail={[hit.series, hit.releaseYear].filter(Boolean).join(' · ')}
          coverUri={hit.coverUrl}
          coverColor={hit.coverColor}
          coverAspect={hit.coverAspect}
          onPress={() => router.push(`/work/${hit.id}`)}
        />
      ))}
    </PagedList>
  )
}

/** AudioBookBay's uploads: its newest, a category's, or those a search found. */
function UploadResults({ feed }: { feed: AbbFeed }) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const results = useFeed(feed)
  const { preferredLanguage } = usePreferences()

  // Searches and genres list the preferred language first, each page on its own so nothing shown
  // moves as more come in; the latest uploads stay newest first.
  const unique = uniqueBy(
    results.data?.pages.flatMap((page) =>
      feed.kind === 'latest' ? page.items : byPreferredLanguage(page.items, preferredLanguage),
    ) ?? [],
    (hit) => hit.id,
  )

  const error = results.error

  return (
    <PagedList
      results={results}
      count={unique.length}
      failed={
        error instanceof AbbSilentError ? (
          <Failed
            offline
            title={t({
              message: 'AudioBookBay isn’t answering',
              comment: 'Title when AudioBookBay stops answering, likely blocking the phone',
            })}
            message={t({
              message:
                'It may have blocked your connection for a while. A proxy in Settings gets around it.',
              comment: 'Shown when AudioBookBay may have blocked or rate limited the phone',
            })}
            onRetry={() => void results.refetch()}
          />
        ) : (
          <Failed
            offline={error instanceof NetworkError}
            title={t({
              message: 'AudioBookBay couldn’t be reached',
              comment: 'Title when loading uploads from AudioBookBay failed',
            })}
            message={
              // A proxy or connection problem is named as one; anything else points at the address.
              error instanceof ProxyAuthError || error instanceof NetworkError
                ? errorText(error)
                : t({
                    message: 'Check its address in Settings, or try again in a moment.',
                    comment: 'Hint when AudioBookBay could not be reached',
                  })
            }
            onRetry={() => void results.refetch()}
          />
        )
      }
      empty={
        <Empty
          glyph='search'
          height='fill'
          title={t({ message: 'No audiobooks found', comment: 'Empty search results title' })}
          message={t({
            message: 'Try the title or the author’s name on its own.',
            comment: 'Empty search results hint',
          })}
        />
      }
    >
      {unique.map((listing, index) => (
        <BookRow
          key={listing.id}
          card={{ index, count: unique.length }}
          title={listing.title}
          subtitle={listing.author}
          detail={listingDetail(listing)}
          coverUri={listing.coverUrl}
          onPress={() => router.push(`/book/${listing.id}`)}
        />
      ))}
    </PagedList>
  )
}

/**
 * The Browse tab: the newest uploads and Hardcover's trending books to look through, and a search
 * field over them for audiobooks, books, series and e-books.
 */
export function BrowseScreen() {
  const { t } = useLingui()
  const connected = Boolean(useHardcoverKey())
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(latestKey)
  const [browseKey, setBrowseKey] = useState(trendingKey)
  const genres = useHardcoverGenres(connected)
  const [source, setSource] = useState<Source>('books')
  const debounced = useDebounced(query.trim(), 400)
  const searching = debounced.length >= 2
  // Books and series come from Hardcover, so without it a search finds uploads or e-books.
  const chosen = connected || source === 'ebooks' ? source : 'uploads'
  // With Hardcover, a search finds books or series first; a book then gathers its uploads.
  const hardcoverSource = searching && (chosen === 'books' || chosen === 'series') ? chosen : null
  const ebookSearch = searching && chosen === 'ebooks'
  // Before a search, Hardcover's trending books and genres lead; AudioBookBay's feeds without it.
  const browsingHardcover = !searching && connected

  const feed: AbbFeed = searching
    ? { kind: 'search', query: debounced }
    : category === latestKey
      ? { kind: 'latest' }
      : { kind: 'category', slug: category }

  const sources = [
    ...(connected
      ? [
          {
            key: 'books',
            label: t({ message: 'Books', comment: 'Search chip: books on Hardcover' }),
          },
          {
            key: 'series',
            label: t({ message: 'Series', comment: 'Search chip: series on Hardcover' }),
          },
        ]
      : []),
    {
      key: 'uploads',
      label: t({ message: 'Audiobooks', comment: 'Search chip: audiobook uploads' }),
    },
    {
      key: 'ebooks',
      label: t({ message: 'E-books', comment: 'Search chip: EPUB files to read' }),
    },
  ]

  const browseChips = [
    {
      key: trendingKey,
      label: t({ message: 'Trending', comment: 'Browse chip: books trending on Hardcover' }),
    },
    ...(genres.data ?? []).map((genre) => ({ key: `genre:${genre.id}`, label: genre.name })),
  ]

  const categoryNames: Record<AbbCategorySlug, string> = {
    'sci-fi': t({ message: 'Sci-Fi', comment: 'Browse chip: an audiobook genre' }),
    fantasy: t({ message: 'Fantasy', comment: 'Browse chip: an audiobook genre' }),
    mystery: t({ message: 'Mystery', comment: 'Browse chip: an audiobook genre' }),
    thriller: t({ message: 'Thriller', comment: 'Browse chip: an audiobook genre' }),
    romance: t({ message: 'Romance', comment: 'Browse chip: an audiobook genre' }),
    horror: t({ message: 'Horror', comment: 'Browse chip: an audiobook genre' }),
    'historical-fiction': t({
      message: 'Historical Fiction',
      comment: 'Browse chip: an audiobook genre',
    }),
    litrpg: t({ message: 'LitRPG', comment: 'Browse chip: an audiobook genre' }),
    bestsellers: t({ message: 'Bestsellers', comment: 'Browse chip: an audiobook genre' }),
    classic: t({ message: 'Classic', comment: 'Browse chip: an audiobook genre' }),
    'autobiography-biographies': t({
      message: 'Biographies',
      comment: 'Browse chip: an audiobook genre',
    }),
    history: t({ message: 'History', comment: 'Browse chip: an audiobook genre' }),
    science: t({ message: 'Science', comment: 'Browse chip: an audiobook genre' }),
    'self-help': t({ message: 'Self-help', comment: 'Browse chip: an audiobook genre' }),
    business: t({ message: 'Business', comment: 'Browse chip: an audiobook genre' }),
    'true-crime': t({ message: 'True Crime', comment: 'Browse chip: an audiobook genre' }),
    humor: t({ message: 'Humor', comment: 'Browse chip: an audiobook genre' }),
    children: t({ message: 'Children', comment: 'Browse chip: an audiobook genre' }),
    'teen-young-adult': t({
      message: 'Teen & Young Adult',
      comment: 'Browse chip: an audiobook genre',
    }),
  }

  const chips = [
    { key: latestKey, label: t({ message: 'Latest', comment: 'Browse chip: newest uploads' }) },
    ...abbCategories.map((item) => ({ key: item.slug, label: categoryNames[item.slug] })),
  ]

  return (
    <Screen
      title={t({ message: 'Browse', comment: 'Title of the browse and search screen' })}
      appBar='none'
      aboveNavigationBar
      // The field and its chips slide away as results scroll, and return on the way back up.
      header={
        <>
          <SearchField
            initialValue=''
            placeholder={t({ message: 'Find books', comment: 'Browse search field placeholder' })}
            onChange={setQuery}
            beforeChips
          />
          {searching ? (
            <ChipRow
              chips={sources}
              selected={chosen}
              onSelect={(key) => {
                if (isSource(key)) {
                  setSource(key)
                }
              }}
            />
          ) : browsingHardcover ? (
            <ChipRow chips={browseChips} selected={browseKey} onSelect={setBrowseKey} />
          ) : (
            <ChipRow chips={chips} selected={category} onSelect={setCategory} />
          )}
        </>
      }
    >
      {ebookSearch ? (
        <EbookResults query={debounced} />
      ) : browsingHardcover ? (
        <HardcoverBrowseList browse={browseFor(browseKey)} />
      ) : hardcoverSource ? (
        <HardcoverResults
          query={debounced}
          source={hardcoverSource}
          onSearchUploads={() => setSource('uploads')}
        />
      ) : (
        <UploadResults feed={feed} />
      )}
    </Screen>
  )
}
