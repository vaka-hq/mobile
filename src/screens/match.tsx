import { useLingui } from '@lingui/react/macro'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { fillMaxSize, fillMaxWidth, weight } from '@/lib/compose-modifiers'
import { Column, LazyColumn } from '@/lib/compose-ui'
import { useFeedback } from '@/lib/feedback'
import { splitTitle } from '@/library/display'
import { useBook, useChooseHardcover, useHardcoverSearch } from '@/library/queries'
import { useHardcoverKey } from '@/settings/hardcover-key'
import { searchableTitle } from '@/sources/hardcover/match'
import { useErrorText } from '@/ui/errors'
import { useLabels } from '@/ui/labels'
import {
  BookRow,
  ChosenMark,
  Empty,
  InfoRow,
  LoadingPage,
  Notice,
  SearchField,
} from '@/ui/primitives'
import { Screen } from '@/ui/screen'

/**
 * Lets the listener pick the Hardcover book that matches an AudioBookBay post, or none. Opened
 * from a book's page (`from=work`), the choice leaves that page for the recording's new one.
 */
export function MatchScreen() {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const labels = useLabels()
  const { showFeedback } = useFeedback()
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>()
  const book = useBook(id)
  const connected = Boolean(useHardcoverKey())
  const choose = useChooseHardcover(id)
  const [query, setQuery] = useState<string | null>(null)
  const [debounced, setDebounced] = useState('')

  const initial = book.data
    ? [searchableTitle(book.data.abb.title), book.data.abb.author].filter(Boolean).join(' ')
    : ''

  const text = query ?? initial

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(text), 400)

    return () => clearTimeout(timeout)
  }, [text])

  const results = useHardcoverSearch(debounced, connected)

  function select(hardcoverId: number | null) {
    choose.mutate(hardcoverId, {
      onSuccess: () => {
        router.back()

        // The book's page belonged to the old match; the recording now opens as its new one.
        if (from === 'work') {
          router.replace(`/book/${id}`)
        }
      },
      onError: (error) => showFeedback(errorText(error)),
    })
  }

  return (
    <Screen
      title={t({ message: 'Match on Hardcover', comment: 'Title of the Hardcover match picker' })}
      navigation='back'
    >
      <Column modifiers={[fillMaxSize()]}>
        {book.data ? (
          <SearchField
            key={initial}
            initialValue={initial}
            placeholder={t({
              message: 'Title and author',
              comment: 'Hardcover search placeholder',
            })}
            onChange={setQuery}
          />
        ) : null}
        {results.isFetching && !results.data ? (
          <LoadingPage />
        ) : (
          <LazyColumn modifiers={[fillMaxWidth(), weight(1)]} contentPadding={{ bottom: 24 }}>
            {!connected ? (
              <Notice
                glyph='link'
                message={t({
                  message: 'Add a Hardcover API key in Settings first.',
                  comment: 'Match picker without a Hardcover API key',
                })}
              />
            ) : null}
            {results.error ? (
              <Notice
                glyph='warning'
                tone='error'
                message={errorText(results.error)}
                actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
                onAction={() => void results.refetch()}
              />
            ) : null}
            {(results.data ?? []).map((hit, index, hits) => (
              <BookRow
                key={hit.id}
                card={{ index, count: hits.length }}
                title={splitTitle(hit.title, hit.subtitle).title}
                subtitle={labels.authors(hit.authors)}
                detail={[hit.series, hit.releaseYear].filter(Boolean).join(' · ')}
                coverUri={hit.coverUrl}
                coverColor={hit.coverColor}
                coverAspect={hit.coverAspect}
                trailing={book.data?.hardcoverId === hit.id ? <ChosenMark /> : undefined}
                onPress={() => select(hit.id)}
              />
            ))}
            {results.data && results.data.length === 0 ? (
              <Empty
                glyph='search'
                title={t({
                  message: 'No books found on Hardcover',
                  comment: 'Empty Hardcover search',
                })}
              />
            ) : null}
            {book.data ? (
              <InfoRow
                glyph='clear'
                label={t({
                  message: 'None of these',
                  comment: 'Match picker option to unlink Hardcover',
                })}
                value={t({
                  message: 'Use the details from AudioBookBay instead.',
                  comment: 'Explains choosing no Hardcover match',
                })}
                onPress={() => select(null)}
              />
            ) : null}
          </LazyColumn>
        )}
      </Column>
    </Screen>
  )
}
