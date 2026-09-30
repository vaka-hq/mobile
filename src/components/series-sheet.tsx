import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { splitTitle } from '@/library/display'
import { useEbooks } from '@/library/ebooks'
import { hardcoverWorkId } from '@/library/model'
import {
  useFollowedSeries,
  useHardcoverSeries,
  useLibrary,
  useSeriesInLibrary,
} from '@/library/queries'
import { ConfirmDialog } from '@/ui/dialogs'
import { CardItem, Empty, Loading } from '@/ui/primitives'
import { Action } from '@/ui/screen'
import { Sheet, SheetList } from '@/ui/sheets'

/**
 * A series in reading order in a sheet, opened from one of its books. The title row adds the whole
 * series to the library, or takes it out with every book's progress; both ask first. Choosing a
 * book opens it.
 */
export function SeriesSheet({
  seriesId,
  currentBookId,
  onDismiss,
}: {
  seriesId: number
  /** The book the sheet was opened from, highlighted in the list. */
  currentBookId?: number
  onDismiss: () => void
}) {
  const { t } = useLingui()
  const router = useRouter()
  const series = useHardcoverSeries(seriesId)
  const toggle = useSeriesInLibrary(series.data)
  const saved = useFollowedSeries().data?.some((item) => item.id === seriesId) ?? false
  // Shown as asked for at once, while the books are added or removed.
  const followed = toggle.isPending ? (toggle.variables ?? saved) : saved
  const [asking, setAsking] = useState(false)
  const books = series.data?.books ?? []

  const library = new Map(
    (useLibrary().data ?? []).flatMap((entry) =>
      entry.work.hardcoverId === null ? [] : [[entry.work.hardcoverId, entry] as const],
    ),
  )

  const ebooks = useEbooks()

  /**
   * Where the listener stands with a book of the series: finished, or listening or reading,
   * whichever was done last, else not started, or not in the library at all.
   */
  function statusOf(hardcoverId: number) {
    const entry = library.get(hardcoverId)
    const workId = hardcoverWorkId(hardcoverId)

    const readAt = Math.max(
      0,
      ...[...ebooks.values()].flatMap((ebook) =>
        ebook.workId === workId && ebook.lastReadAt !== null ? [ebook.lastReadAt] : [],
      ),
    )

    const heardAt = entry?.playback ? (entry.work.lastPlayedAt ?? entry.playback.updatedAt) : 0

    if (entry && (entry.work.finishedAt !== null || entry.playback?.finished)) {
      return t({
        message: 'Finished',
        context: 'book status',
        comment: 'Series sheet: a book of the series was finished',
      })
    }

    if (readAt > 0 || heardAt > 0) {
      return readAt > heardAt
        ? t({
            message: 'Reading',
            context: 'book status',
            comment: 'Series sheet: a book of the series is being read',
          })
        : t({
            message: 'Listening',
            context: 'book status',
            comment: 'Series sheet: a book of the series is being listened to',
          })
    }

    return entry
      ? t({
          message: 'Not started',
          context: 'book status',
          comment: 'Series sheet: a book of the series is in the library but not started',
        })
      : t({
          message: 'Not in library',
          context: 'book status',
          comment: 'Series sheet: a book of the series is not in the library',
        })
  }

  const current = books.findIndex((book) => book.id === currentBookId)
  const missing = books.filter((book) => !library.has(book.id)).length
  const held = books.length - missing

  const dialog = asking ? (
    followed ? (
      <ConfirmDialog
        title={t({ message: 'Remove series from library?', comment: 'Dialog title' })}
        message={t({
          message: plural(held, {
            one: 'Its book leaves your library. You’ll lose its progress, notes and downloads.',
            other:
              'All # books leave your library. You’ll lose their progress, notes and downloads.',
          }),
          comment:
            'Warns that removing a series takes its books out of the library with where listening and reading stopped, and their bookmarks',
        })}
        confirmLabel={t({
          message: 'Remove',
          comment: 'Confirms removing a series from the library',
        })}
        onConfirm={() => toggle.mutate(false)}
        onDismiss={() => setAsking(false)}
      />
    ) : (
      <ConfirmDialog
        title={t({ message: 'Add series to library?', comment: 'Dialog title' })}
        message={t({
          message: plural(missing, {
            one: 'Adds # book, and new ones as they come out.',
            other: 'Adds # books, and new ones as they come out.',
          }),
          comment:
            'Explains adding a whole series: the books not in the library yet, and later ones',
        })}
        confirmLabel={t({ message: 'Add', comment: 'Confirms adding a series to the library' })}
        onConfirm={() => toggle.mutate(true)}
        onDismiss={() => setAsking(false)}
      />
    )
  ) : null

  return (
    <>
      <Sheet
        title={series.data?.name ?? ''}
        // Said here rather than on the book's page, where the series row stays short.
        subtitle={
          followed
            ? t({
                message: 'Whole series in library',
                comment: 'Series row when every book of the series is in the library',
              })
            : null
        }
        action={
          series.data ? (
            <Action
              glyph={followed ? 'added' : 'add'}
              label={
                followed
                  ? t({
                      message: 'Remove series from library',
                      comment: 'Takes a whole series out of the library',
                    })
                  : t({
                      message: 'Add series to library',
                      comment: 'Adds every book of a series to the library',
                    })
              }
              // The icon swaps rather than the button being disabled, which app bars drop.
              onPress={() => {
                if (!toggle.isPending) {
                  setAsking(true)
                }
              }}
            />
          ) : null
        }
        onDismiss={onDismiss}
      >
        {(close) =>
          series.isPending ? (
            <Loading />
          ) : series.error && !series.data ? (
            <Empty
              glyph='warning'
              title={t({
                message: 'This series could not be loaded',
                comment: 'Series sheet load failure',
              })}
              actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
              onAction={() => void series.refetch()}
            />
          ) : (
            <SheetList initialIndex={Math.max(0, current)}>
              {books.map((book, index) => (
                <CardItem
                  key={book.id}
                  card={{ index, count: books.length }}
                  selected={book.id === currentBookId}
                  leading={{ text: String(book.position) }}
                  headline={splitTitle(book.title, book.subtitle).title}
                  supporting={[
                    book.releaseYear ? String(book.releaseYear) : null,
                    statusOf(book.id),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={() => {
                    close()

                    if (book.id !== currentBookId) {
                      router.push(`/work/${book.id}`)
                    }
                  }}
                />
              ))}
            </SheetList>
          )
        }
      </Sheet>
      {dialog}
    </>
  )
}
