import { useLingui } from '@lingui/react/macro'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ebookFormat, useEbookProgress } from '@/components/ebook-row'
import { type EbookResult, ebookResultOf, useEbooks } from '@/library/ebooks'
import { useWorkEbooks } from '@/library/queries'
import { Empty, Group, type GroupRow, List, Notice } from '@/ui/primitives'
import { Screen } from '@/ui/screen'

/**
 * Every EPUB found for a Hardcover book, laid out as the book's recordings are: grouped by who
 * published it, with its language as the group's caption, each file's format and size, then its
 * year. The best come first and the one the book is read in is selected. Choosing another makes
 * it the book's e-book and returns to the book, as choosing a recording does; Read downloads it.
 * Files are downloaded directly, not through torrents, so none is checked beforehand: one that
 * cannot be downloaded says so when Read tries, and another can be chosen.
 */
export function WorkEbooksScreen() {
  const { t } = useLingui()
  const router = useRouter()
  const progress = useEbookProgress()
  const ebooks = useEbooks()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { chosen, choice, results, finding, search, choose } = useWorkEbooks(Number(id), true)

  // A file kept for the book but no longer found still shows, so the choice is always listed.
  const listed =
    chosen && !results.some((result) => result.md5 === chosen.md5)
      ? [ebookResultOf(chosen), ...results]
      : results

  // One group per publisher and language, in the order the best of each was found.
  const groupOf = (result: EbookResult) => `${result.publisher ?? ''}\n${result.language ?? ''}`

  const groups = [...new Set(listed.map(groupOf))].map((key) =>
    listed.filter((result) => groupOf(result) === key),
  )

  function rowOf(result: EbookResult): GroupRow {
    const ebook = ebooks.get(result.md5) ?? null

    return {
      key: result.md5,
      label: [ebookFormat(result), result.size].filter(Boolean).join(' · '),
      value: [progress(ebook), result.year].filter(Boolean).join(' · ') || undefined,
      selected: result.md5 === choice?.md5,
      pending: ebook?.status === 'downloading',
      badge:
        ebook?.kept && ebook.status === 'done'
          ? {
              glyph: 'onPhone',
              description: t({
                message: 'Downloaded',
                comment: 'E-book row for a file already downloaded',
              }),
            }
          : undefined,
      onPress: () => {
        choose.mutate(result)
        router.back()
      },
    }
  }

  return (
    <Screen
      title={t({
        message: 'Select e-book',
        comment: 'Title of the screen choosing which EPUB file of a book to read',
      })}
      navigation='back'
    >
      {finding === 'none' ? (
        <Empty
          glyph='read'
          height='fill'
          title={t({ message: 'No e-books found', comment: 'No EPUB files were found for a book' })}
          message={t({
            message: 'Try searching for the book by its title in Browse.',
            comment: 'Hint when nothing was found for a book; Browse is the tab for finding books',
          })}
          actionLabel={t({
            message: 'Open Browse',
            comment: 'Opens the Browse tab from an empty list of sources',
          })}
          onAction={() => router.navigate('/browse')}
        />
      ) : (
        // Until the search is done, even with a file already chosen, so the list does not grow
        // around it as the others come in.
        <List grouped bottomPadding={32} loading={finding === 'searching'}>
          {search.error ? (
            <Notice
              glyph='warning'
              tone='error'
              message={t({
                message: 'E-books could not be searched. Try again in a moment.',
                comment: 'Searching for a book’s e-books failed',
              })}
              actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
              onAction={() => void search.refetch()}
            />
          ) : null}
          {groups.map((files) => {
            const first = files[0]
            const publisher = first?.publisher

            return first ? (
              <Group
                key={groupOf(first)}
                title={
                  publisher
                    ? t({
                        message: `Published by ${publisher}`,
                        comment: 'Heading over the e-book files of one publisher',
                      })
                    : t({
                        message: 'Publisher not named',
                        comment: 'Heading over e-book files that do not name their publisher',
                      })
                }
                caption={first.language}
                rows={files.map((result) => rowOf(result))}
              />
            ) : null
          })}
        </List>
      )}
    </Screen>
  )
}
