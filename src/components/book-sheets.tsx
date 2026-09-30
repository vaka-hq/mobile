import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { Row } from '@/lib/compose-ui'
import { useFeedback } from '@/lib/feedback'
import type { Bookmark } from '@/library/model'
import {
  useAddBookmark,
  useBook,
  useBookmarkNote,
  useBookmarks,
  useDeleteBookmark,
} from '@/library/queries'
import { bookPosition, chapterEnd, chapterIndexAt } from '@/library/timeline'
import { playFrom } from '@/player/navigation'
import { usePlayer } from '@/player/use-player'
import { TextDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { clock } from '@/ui/format'
import { useLabels } from '@/ui/labels'
import { CardItem, Crossfade, Empty } from '@/ui/primitives'
import { Action } from '@/ui/screen'
import { Sheet, SheetList, useOpenSheetBody } from '@/ui/sheets'

export type BookSheetProps = {
  /** The stream whose chapters or bookmarks are listed. */
  bookId: string
  onDismiss: () => void
  /** Runs once playback has moved to the chosen place, such as opening the full player. */
  onPlay?: () => void
}

/** The book as the player knows it when it is playing, else as stored. */
function useShownBook(bookId: string) {
  const book = useBook(bookId)
  const player = usePlayer()
  const current = player.book?.id === bookId
  const data = current && player.book ? player.book : book.data

  return {
    data,
    current,
    player,
    chapters: data?.chapters ?? [],
    durations: data?.durations ?? data?.tracks?.map(() => null) ?? [],
  }
}

/** The chapter list in a sheet, opened at the chapter playing; choosing one plays from it. */
export function ChaptersSheet({ bookId, onDismiss, onPlay }: BookSheetProps) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const labels = useLabels()
  const { showFeedback } = useFeedback()
  const { data, current, player, chapters, durations } = useShownBook(bookId)
  const active = current ? chapterIndexAt(chapters, player.track, player.position) : -1

  return (
    <Sheet
      title={t({ message: 'Chapters', comment: 'Title of the chapter list' })}
      onDismiss={onDismiss}
    >
      {(close) =>
        data && chapters.length === 0 ? (
          <Empty
            glyph='chapters'
            title={t({
              message: 'No chapters yet',
              comment: 'Chapter list before chapters are read',
            })}
          />
        ) : (
          <SheetList initialIndex={Math.max(0, active)}>
            {chapters.map((chapter, index) => {
              const end = chapterEnd(chapters, index, durations)
              const selected = index === active

              return (
                <CardItem
                  key={`${chapter.track}:${chapter.start}`}
                  card={{ index, count: chapters.length }}
                  selected={selected}
                  leading={selected ? { glyph: 'listen' } : { text: String(index + 1) }}
                  headline={labels.chapter(chapter.title, index)}
                  supporting={clock(bookPosition(durations, chapter.track, chapter.start))}
                  detail={end !== null ? clock(end - chapter.start) : null}
                  onPress={() => {
                    close()
                    playFrom(bookId, chapter.track, chapter.start)
                      .then(onPlay)
                      .catch((error: Error) => showFeedback(errorText(error)))
                  }}
                />
              )
            })}
          </SheetList>
        )
      }
    </Sheet>
  )
}

/** Saved places in a book, with adding one at the current position while it plays. */
export function BookmarksSheet({ bookId, onDismiss, onPlay }: BookSheetProps) {
  const { t, i18n } = useLingui()
  const errorText = useErrorText()
  const labels = useLabels()
  const { showFeedback } = useFeedback()
  const bookmarks = useBookmarks(bookId)
  const addBookmark = useAddBookmark(bookId)
  const deleteBookmark = useDeleteBookmark(bookId)
  const bookmarkNote = useBookmarkNote(bookId)
  // The bookmark whose note is being written.
  const [noting, setNoting] = useState<Bookmark | null>(null)
  const { current, player, chapters, durations } = useShownBook(bookId)
  const list = bookmarks.data ?? []
  // What is visible of the sheet below its header when it opens, for centring the empty state.
  const openBody = useOpenSheetBody()

  return (
    <Sheet
      title={t({ message: 'Bookmarks', comment: 'Title of the bookmark list' })}
      action={
        current ? (
          <Action
            glyph='bookmarkAdd'
            label={t({
              message: 'Add bookmark',
              comment: 'Adds a bookmark at the current position',
            })}
            onPress={() => addBookmark.mutate({ track: player.track, position: player.position })}
          />
        ) : null
      }
      onDismiss={onDismiss}
    >
      {(close) => (
        <>
          {/* The list and its empty state crossfade as the first bookmark arrives or the last goes. */}
          <Crossfade
            showSecond={bookmarks.data?.length === 0}
            first={
              <SheetList minHeight={openBody}>
                {list.map((bookmark, index) => {
                  const chapter = chapterIndexAt(chapters, bookmark.track, bookmark.position)

                  return (
                    <CardItem
                      key={bookmark.id}
                      card={{ index, count: list.length }}
                      leading={{ glyph: 'bookmarkFilled' }}
                      headline={clock(bookPosition(durations, bookmark.track, bookmark.position))}
                      supporting={[
                        bookmark.note,
                        [
                          chapters.length > 1
                            ? labels.chapter(chapters[chapter]?.title, chapter)
                            : null,
                          i18n.date(new Date(bookmark.createdAt), { dateStyle: 'medium' }),
                        ]
                          .filter(Boolean)
                          .join(' · '),
                      ]
                        .filter(Boolean)
                        .join('\n')}
                      action={
                        <Row>
                          <Action
                            glyph='note'
                            label={
                              bookmark.note
                                ? t({ message: 'Edit note', comment: 'Edits a bookmark’s note' })
                                : t({ message: 'Add a note', comment: 'Adds a note to a bookmark' })
                            }
                            onPress={() => setNoting(bookmark)}
                          />
                          <Action
                            glyph='delete'
                            label={t({ message: 'Delete bookmark', comment: 'Removes a bookmark' })}
                            onPress={() => deleteBookmark.mutate(bookmark.id)}
                          />
                        </Row>
                      }
                      onPress={() => {
                        close()
                        playFrom(bookId, bookmark.track, bookmark.position)
                          .then(onPlay)
                          .catch((error: Error) => showFeedback(errorText(error)))
                      }}
                    />
                  )
                })}
              </SheetList>
            }
            second={
              <Empty
                glyph='bookmarks'
                title={t({ message: 'No bookmarks', comment: 'Empty bookmark list title' })}
                height={Math.max(160, openBody)}
              />
            }
          />
          {noting ? (
            <TextDialog
              title={t({ message: 'Note', comment: 'Title of the dialog for a bookmark’s note' })}
              label={t({ message: 'Your note', comment: 'Field label in the note dialog' })}
              initialValue={noting.note ?? ''}
              multiline
              confirmLabel={t({ message: 'Save', comment: 'Saves a note' })}
              onConfirm={async (note) => {
                try {
                  await bookmarkNote.mutateAsync({ id: noting.id, note })
                } catch (error) {
                  return errorText(error instanceof Error ? error : null)
                }

                setNoting(null)

                return null
              }}
              onDismiss={() => setNoting(null)}
            />
          ) : null}
        </>
      )}
    </Sheet>
  )
}
