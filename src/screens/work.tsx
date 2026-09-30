import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { BookHeader, useListenAction } from '@/components/book-details'
import { useBookMenu } from '@/components/book-menu'
import { useDownloads } from '@/components/downloads-sheet'
import { ebookSource, useEbookDownloadFailed } from '@/components/ebook-row'
import { useLibraryToggle } from '@/components/library-toggle'
import { useAskWhereToRead } from '@/components/place-prompt'
import { SeriesSheet } from '@/components/series-sheet'
import { useFeedback } from '@/lib/feedback'
import { splitTitle } from '@/library/display'
import { readyToRead, useEbooks } from '@/library/ebooks'
import { hardcoverWorkId, workIdOf } from '@/library/model'
import { useOfflineBooks } from '@/library/offline'
import {
  useLastHeardAt,
  useListeningProgress,
  useTimeline,
  useWorkEbooks,
  useWorkStreams,
} from '@/library/queries'
import { bookDuration } from '@/library/timeline'
import { useNowPlaying } from '@/player/use-player'
import { useErrorText } from '@/ui/errors'
import { useLabels } from '@/ui/labels'
import {
  Empty,
  ExpandableTextCard,
  type GroupRow,
  List,
  FitToScreen,
  SpringActions,
  type SpringAction,
  type Stat,
  StatStrip,
  TagGroup,
} from '@/ui/primitives'
import { Screen } from '@/ui/screen'

/**
 * A Hardcover book: the book's own cover and details, Listen, Read and Add to library, and a row
 * under each of Listen and Read to choose another recording or e-book. Listen plays a good
 * default, the most read narrator's recording from its best source, and Read opens the best
 * e-book found until another is chosen.
 */
export function WorkScreen() {
  const { t, i18n } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const labels = useLabels()
  const [seriesOpen, setSeriesOpen] = useState(false)
  const params = useLocalSearchParams<{ id: string; stream?: string }>()
  const hardcoverId = Number(params.id)
  const opened = params.stream ?? null

  const { workId, work, record, recordings, groups, finding, stream, choose } = useWorkStreams(
    hardcoverId,
    opened,
  )

  const libraryToggle = useLibraryToggle(workId, work.data ?? null)
  const offline = useOfflineBooks()
  const inLibrary = Boolean(record.data?.inLibrary)
  const remembered = useRef<string | null>(null)

  useTimeline(stream?.tracks ? stream : undefined)

  // A post opened from AudioBookBay results is an explicit choice of source: remember it, then let
  // the remembered stream lead so a later pick on the source screen is not overridden.
  useEffect(() => {
    if (opened && work.data && remembered.current !== opened) {
      remembered.current = opened
      choose.mutate(opened, { onSuccess: () => router.setParams({ stream: undefined }) })
    }
  }, [opened, work.data, choose, router])

  // Only the way the book was followed last reads as picking it up: Resume on Listen after
  // listening, Continue on Read after reading, never both.
  const heardAt = useLastHeardAt(workId).data ?? null
  const allEbooks = useEbooks()

  const readAt = [...allEbooks.values()].reduce<number | null>(
    (latest, ebook) =>
      ebook.workId === workId && ebook.lastReadAt !== null
        ? Math.max(latest ?? 0, ebook.lastReadAt)
        : latest,
    null,
  )

  // A finished book, marked or listened to the end, starts over either way: neither button picks
  // it up, and its status says it is done.
  const listening = useListeningProgress(workId).data ?? null
  const finished = Boolean(record.data?.finishedAt) || listening?.progress === 1
  const listenedLast = !finished && heardAt !== null && heardAt >= (readAt ?? 0)
  const readLast = !finished && readAt !== null && readAt > (heardAt ?? 0)

  // How far into the book the listener is, the way it was followed last. The book playing now
  // counts live; otherwise the saved place does.
  const now = useNowPlaying()

  const live =
    now && workIdOf(now.book) === workId && now.summary.bookTotal
      ? {
          progress: now.summary.bookElapsed / now.summary.bookTotal,
          left: Math.max(0, now.summary.bookTotal - now.summary.bookElapsed),
        }
      : null

  const heard = live ?? listening

  const lastRead = [...allEbooks.values()]
    .filter((ebook) => ebook.workId === workId && ebook.lastReadAt !== null)
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0]

  // One line, the status leading into the details: “Listening, 5 h 12 min left (32%)”.
  const heardPercent =
    heard?.progress !== null && heard?.progress !== undefined
      ? i18n.number(heard.progress, { style: 'percent' })
      : null

  const heardLeft =
    heard?.left !== null && heard?.left !== undefined ? labels.duration(heard.left) : null

  const readPercent = lastRead ? i18n.number(lastRead.progress, { style: 'percent' }) : null
  const readPage = lastRead?.page ?? null
  const readPages = lastRead?.pages ?? null

  const status = finished
    ? t({ message: 'Finished', context: 'book status', comment: 'Book page progress' })
    : listenedLast && heard
      ? heardLeft && heardPercent
        ? t({
            message: `Listening, ${heardLeft} left (${heardPercent})`,
            comment: 'Book page progress: listening, with the time left and how far in',
          })
        : heardPercent
          ? t({
              message: `Listening, ${heardPercent}`,
              comment: 'Book page progress: listening, with how far in',
            })
          : t({ message: 'Listening', context: 'book status', comment: 'Book page progress' })
      : readLast && lastRead
        ? readPage && readPages
          ? t({
              message: `Reading page ${readPage} of ${readPages} (${readPercent})`,
              comment: 'Book page progress: reading, with the page and how far in',
            })
          : t({
              message: `Reading, ${readPercent}`,
              comment: 'Book page progress: reading, with how far in',
            })
        : t({ message: 'Not started', context: 'book status', comment: 'Book page progress' })

  // The last row of the card: where the listener stands with the book, the way it was followed
  // last, its icon saying not started, under way or finished.
  const progressRow: GroupRow | null = work.data
    ? {
        key: 'progress',
        glyph: finished
          ? 'progressDone'
          : (listenedLast && heard) || (readLast && lastRead)
            ? 'progress'
            : 'progressNone',
        label: status,
      }
    : null

  const listen = useListenAction({
    book: stream,
    listened: listenedLast,
    beforeListen: async () => {
      if (stream) {
        await choose.mutateAsync(stream.id)
      }
    },
  })

  const group = groups.find((item) => item.posts.some((post) => post.id === stream?.id))

  const source = stream
    ? [
        group && group.narrators.length > 0
          ? labels.fewNames(group.narrators)
          : stream.abb.narrator,
        stream.abb.format,
        stream.abb.bitrate,
      ]
        .filter(Boolean)
        .join(' · ') ||
      t({
        message: 'Unknown',
        comment: 'Source row when the chosen upload names no narrator, format or bitrate',
      })
    : finding === 'searching'
      ? t({
          message: 'Finding sources…',
          comment: 'Row under the Listen button while recordings of the book are looked up',
        })
      : finding === 'checking'
        ? t({
            message: 'Checking availability…',
            comment:
              'Row under the Listen button while checking which recordings can play right away',
          })
        : recordings.listings.error
          ? t({
              message: 'Sources could not be loaded',
              comment: 'Row under the Listen button when looking up recordings failed',
            })
          : t({
              message: 'No sources found',
              comment: 'Row under the Listen button when the book has no recordings to play',
            })

  // The row names the chosen recording itself; tapping it picks another.
  const sourceRow: GroupRow = {
    key: 'source',
    glyph: 'listen',
    label: source,
    // The recording Listen plays marks when it is saved to play without a connection.
    badge:
      stream && offline.get(stream.id)?.status === 'done'
        ? {
            glyph: 'onPhone',
            description: t({
              message: 'Downloaded',
              comment: 'Marks the recording row when the audiobook is downloaded to the phone',
            }),
          }
        : undefined,
    onPress: () => router.push(`/work/${hardcoverId}/streams`),
  }

  const downloads = useDownloads({ hardcoverId, stream, recordings: recordings.books })
  const read = useReadAction(hardcoverId, readLast)
  const data = work.data

  const bookMenu = useBookMenu({
    workId,
    hardcover: data ?? null,
    record: record.data ?? null,
    onManageStorage: downloads.openStorage,
    onChangeMatch: stream ? () => router.push(`/book/${stream.id}/match?from=work`) : null,
  })

  const series = data?.series[0] ?? null
  const seriesId = series?.id ?? null

  // The series the book belongs to opens in a sheet, where the whole series can be added too.
  const seriesRow: GroupRow | null =
    series && seriesId !== null
      ? {
          key: 'series',
          glyph: 'series',
          label:
            series.position !== null
              ? t({
                  message: `Book ${series.position} of ${series.name}`,
                  comment: 'Position in a book series, for example “Book 2 of The Expanse”',
                })
              : series.name,
          onPress: () => setSeriesOpen(true),
        }
      : null

  // Only the title: Hardcover's subtitles are often taglines, and its own page leaves them out.
  const title = data ? splitTitle(data.title, data.subtitle).title : null

  // Formatted for the reader's locale: “4.3” in English, “4,3” in Swedish.
  const average = data?.rating
    ? i18n.number(data.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : null

  // Hardcover's headline opens the description and stands alone until the card is expanded. A
  // description that already begins with it, or a book with only one of the two, shows it once.
  const headline = data?.headline ?? null
  const description = data?.description ?? null

  const about = description
    ? {
        summary: headline && !description.startsWith(headline) ? headline : null,
        text: description,
      }
    : headline
      ? { summary: null, text: headline }
      : null

  const ratingsCount = data?.ratingsCount ?? 0
  // Short counts such as “12K” keep the label on one line.
  const ratings = i18n.number(ratingsCount, { notation: 'compact', maximumFractionDigits: 1 })

  const length =
    (stream ? bookDuration(stream.durations) : null) ??
    data?.defaultRecording?.durationSeconds ??
    null

  const stats: Stat[] = []

  if (average) {
    stats.push({
      key: 'rating',
      value: average,
      label:
        ratingsCount > 0
          ? t({
              message: plural(ratingsCount, {
                one: `${ratings} rating`,
                other: `${ratings} ratings`,
              }),
              comment:
                'Under the average Hardcover rating: how many readers rated, like “12K ratings”',
            })
          : t({ message: 'Rating', comment: 'Label under the average Hardcover rating' }),
    })
  }

  if (data?.pages) {
    stats.push({
      key: 'pages',
      value: i18n.number(data.pages),
      label: t({ message: 'Pages', comment: 'Label under the printed page count' }),
    })
  }

  if (length !== null) {
    stats.push({
      key: 'length',
      value: labels.duration(length),
      label: t({ message: 'Length', comment: 'Label under the audiobook’s listening time' }),
    })
  }

  return (
    <Screen title='' navigation='back' collapseOnScroll actions={data ? bookMenu.menu : null}>
      <List grouped bottomPadding={32} loading={work.isPending} fitsViewport>
        {work.error && !data ? (
          <Empty
            glyph='warning'
            title={t({
              message: 'This book could not be loaded from Hardcover',
              comment: 'Hardcover book load failure title',
            })}
            message={errorText(work.error)}
            actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
            onAction={() => void work.refetch()}
          />
        ) : null}
        {data && title ? (
          // The cover takes the height the title and the card leave, so all of them show as the
          // page opens, above the mini player or the navigation bar.
          <FitToScreen>
            <BookHeader
              fitted
              title={title}
              subtitle={null}
              released={data.releaseYear ? String(data.releaseYear) : null}
              authors={data.authors}
              narrators={[]}
              // With an ID the series has its own row below the buttons instead.
              series={seriesId === null ? series : null}
              cover={{ uri: data.coverUrl, color: data.coverColor, aspect: data.coverAspect }}
            />
            <SpringActions
              actions={[
                { ...listen, primary: true },
                read.action,
                {
                  glyph: inLibrary ? 'added' : 'add',
                  label: inLibrary
                    ? t({
                        message: 'In library',
                        comment: 'Library button when the book is saved',
                      })
                    : t({ message: 'Add to library', comment: 'Toggle on the book page' }),
                  iconOnly: true,
                  selected: inLibrary,
                  onPress: () => libraryToggle.toggle(inLibrary),
                },
              ]}
              rows={[sourceRow, read.row, seriesRow, progressRow].filter((row) => row !== null)}
            />
          </FitToScreen>
        ) : null}
        {stats.length > 0 ? <StatStrip stats={stats} /> : null}
        {about ? (
          <ExpandableTextCard
            title={t({ message: 'About', comment: 'Heading above a book’s description' })}
            summary={about.summary}
            text={about.text}
          />
        ) : null}
        {data && data.genres.length > 0 ? (
          <TagGroup
            title={t({ message: 'Genres', comment: 'Heading above a book’s genres' })}
            tags={data.genres}
          />
        ) : null}
        {data && data.moods.length > 0 ? (
          <TagGroup
            title={t({
              message: 'Moods',
              comment: 'Heading above moods readers tagged the book with',
            })}
            tags={data.moods}
          />
        ) : null}
        {data && data.contentWarnings.length > 0 ? (
          <TagGroup
            title={t({
              message: 'Content warnings',
              comment: 'Heading above sensitive topics readers flagged in the book',
            })}
            tags={data.contentWarnings}
          />
        ) : null}
        {recordings.listings.error ? (
          <Empty
            glyph='warning'
            title={t({
              message: 'Sources could not be searched. Try again in a moment.',
              comment: 'Looking up uploads of a book failed',
            })}
            actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
            onAction={() => void recordings.listings.refetch()}
          />
        ) : null}
      </List>
      {listen.dialog}
      {bookMenu.dialog}
      {libraryToggle.dialog}
      {downloads.sheet}
      {seriesOpen && seriesId !== null ? (
        <SeriesSheet
          seriesId={seriesId}
          currentBookId={hardcoverId}
          onDismiss={() => setSeriesOpen(false)}
        />
      ) : null}
    </Screen>
  )
}

/**
 * Read, the book's other main action, and the row under it naming the e-book it opens. The file
 * chosen for the book, or the best one found, is downloaded first with Download, which then turns
 * into Read; Read asks where to start when listening went further, finding a place carried over
 * from listening in that same question, and opens the reader there. The row lists every file to
 * choose another, as the source row does for recordings.
 */
/** The Read button; with `readLast`, reading was the last way the book was followed. */
function useReadAction(hardcoverId: number, readLast: boolean) {
  const { t, i18n } = useLingui()
  const router = useRouter()
  const { showFeedback } = useFeedback()
  const failed = useEbookDownloadFailed()
  const ebooks = useEbooks()
  const { chosen, choice, finding, choose, fetch } = useWorkEbooks(hardcoverId, false)
  const askWhereToRead = useAskWhereToRead()

  const file = choice ? (ebooks.get(choice.md5) ?? null) : null

  const label = readLast
    ? t({ message: 'Continue', comment: 'Book page button reading on from where reading stopped' })
    : t({ message: 'Read', comment: 'Book page button opening the e-book' })

  // Asked first when the book was listened to more recently: read on from there or from reading.
  async function open() {
    if (!choice || !readyToRead(choice.md5)) {
      return
    }

    const answer = await askWhereToRead(choice.md5, hardcoverWorkId(hardcoverId))

    if (!answer) {
      return
    }

    const path = {
      pathname: '/read/[md5]' as const,
      params: answer.fromListening ? { md5: choice.md5, from: 'listening' } : { md5: choice.md5 },
    }

    // A file already on the phone, such as one opened from Search, becomes the book's e-book.
    if (!chosen) {
      choose.mutate(choice)
    }

    router.push(path)
  }

  // Downloads the file to read, and puts the book in the library; Read then opens it.
  function download() {
    if (choice) {
      fetch.mutate(choice, { onError: () => showFeedback(failed) })
    }
  }

  const action: SpringAction =
    file?.status === 'downloading'
      ? {
          glyph: 'download',
          label:
            file.total > 0
              ? i18n.number(file.bytes / file.total, { style: 'percent' })
              : t({
                  message: 'Downloading',
                  comment: 'Read button while the e-book downloads, before its size is known',
                }),
          primary: true,
          enabled: false,
          onPress: () => undefined,
        }
      : choice && !readyToRead(choice.md5)
        ? {
            glyph: 'download',
            label: fetch.isPending
              ? t({
                  message: 'Starting…',
                  comment: 'Download button of the book’s e-book while its download starts',
                })
              : t({
                  message: 'Download',
                  comment: 'Book page button downloading the e-book before it can be read',
                }),
            primary: true,
            enabled: !fetch.isPending,
            onPress: download,
          }
        : {
            glyph: 'read',
            label,
            primary: true,
            enabled: choice !== null,
            onPress: () => void open(),
          }

  const row: GroupRow = {
    key: 'ebook',
    glyph: 'read',
    label: choice
      ? ebookSource(choice)
      : finding === 'searching'
        ? t({
            message: 'Finding e-books…',
            comment: 'Row under the Read button while e-books of the book are looked up',
          })
        : finding === 'failed'
          ? t({
              message: 'E-books could not be searched',
              comment: 'Row under the Read button when looking up e-books failed',
            })
          : t({
              message: 'No e-books found',
              comment: 'Row under the Read button when the book has no e-books',
            }),
    onPress: () => router.push(`/work/${hardcoverId}/ebooks`),
  }

  return { action, row }
}
