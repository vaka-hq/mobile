import { useLingui } from '@lingui/react/macro'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { BookHeader, ListenPanel, StreamFacts } from '@/components/book-details'
import { useDownloads } from '@/components/downloads-sheet'
import { useLibraryToggle } from '@/components/library-toggle'
import {
  displayAuthors,
  displayCoverArt,
  displayDescription,
  displayNarrators,
  displaySeries,
  displaySubtitle,
  displayTitle,
} from '@/library/display'
import { postWorkId } from '@/library/model'
import { useBook, useHardcoverMatch, useTimeline, useWork } from '@/library/queries'
import { useHardcoverKey } from '@/settings/hardcover-key'
import { useErrorText } from '@/ui/errors'
import { Empty, ExpandableTextCard, type GroupRow, List } from '@/ui/primitives'
import { Action, Screen } from '@/ui/screen'

function useHardcoverRow(
  bookId: string,
  connected: boolean,
  match: ReturnType<typeof useHardcoverMatch>,
): GroupRow {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const label = t({ message: 'Hardcover', comment: 'Name of the book metadata service' })

  if (!connected) {
    return {
      key: 'hardcover',
      glyph: 'link',
      label,
      value: t({
        message: 'Add an API key in Settings for richer details',
        comment: 'Book page hint when no Hardcover API key is stored',
      }),
      onPress: () => router.navigate('/settings'),
    }
  }

  return {
    key: 'hardcover',
    glyph: 'link',
    label,
    value: match.error
      ? errorText(match.error)
      : t({ message: 'No match. Tap to choose.', comment: 'Hardcover unmatched row' }),
    onPress: () => router.push(`/book/${bookId}/match`),
  }
}

/**
 * An AudioBookBay upload. Once it is matched to a Hardcover book, that book's page takes over with
 * this upload chosen as its stream; an unmatched upload is shown, and collected, on its own.
 */
export function BookScreen() {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const connected = Boolean(useHardcoverKey())
  const book = useBook(id)
  const data = book.data
  const match = useHardcoverMatch(data, connected)
  const workId = postWorkId(id)
  const work = useWork(workId)
  const libraryToggle = useLibraryToggle(workId, null)
  const hardcoverRow = useHardcoverRow(id, connected, match)
  const hardcoverId = data?.hardcoverId ?? null
  const matching = connected && Boolean(data) && match.isPending
  const redirecting = hardcoverId !== null

  useTimeline(data?.tracks ? data : undefined)

  useEffect(() => {
    if (hardcoverId !== null) {
      router.replace(`/work/${hardcoverId}?stream=${encodeURIComponent(id)}`)
    }
  }, [hardcoverId, id, router])

  const shown = data && !matching && !redirecting ? data : null
  const downloads = useDownloads({ hardcoverId: null, stream: shown, recordings: [] })
  const description = shown ? displayDescription(shown) : null
  const inLibrary = Boolean(work.data?.inLibrary)

  return (
    <Screen
      title=''
      navigation='back'
      collapseOnScroll
      actions={
        <>
          <Action
            glyph={inLibrary ? 'added' : 'add'}
            label={
              inLibrary
                ? t({ message: 'Remove from library', comment: 'Toggle on the book page' })
                : t({ message: 'Add to library', comment: 'Toggle on the book page' })
            }
            onPress={() => {
              if (shown) {
                libraryToggle.toggle(inLibrary)
              }
            }}
          />
        </>
      }
    >
      <List grouped bottomPadding={32} loading={book.isPending || matching || redirecting}>
        {book.error && !data ? (
          <Empty
            glyph='warning'
            title={t({
              message: 'This audiobook could not be opened',
              comment: 'Book load failure title',
            })}
            message={errorText(book.error)}
            actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
            onAction={() => void book.refetch()}
          />
        ) : null}
        {shown ? (
          <BookHeader
            title={displayTitle(shown)}
            subtitle={displaySubtitle(shown)}
            authors={displayAuthors(shown)}
            narrators={displayNarrators(shown)}
            series={displaySeries(shown)}
            cover={displayCoverArt(shown)}
          />
        ) : null}
        {shown ? <ListenPanel book={shown} /> : null}
        {description ? <ExpandableTextCard text={description} /> : null}
        {shown ? (
          <StreamFacts
            book={shown}
            hardcover={shown.hardcover}
            extraRows={downloads.row ? [downloads.row, hardcoverRow] : [hardcoverRow]}
          />
        ) : null}
      </List>
      {downloads.sheet}
      {libraryToggle.dialog}
    </Screen>
  )
}
