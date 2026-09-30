import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { fillMaxWidth, padding, verticalScroll } from '@/lib/compose-modifiers'
import { Column } from '@/lib/compose-ui'
import { useFeedback } from '@/lib/feedback'
import { type EbookResult, ebookResultOf, removeEbookFile, useEbooks } from '@/library/ebooks'
import { type BookRecord, recordingBytes } from '@/library/model'
import { keepOffline, type OfflineBook, removeOffline, useOfflineBooks } from '@/library/offline'
import { deleteAudiobookDownload, deleteEbookFile, useWorkEbooks } from '@/library/queries'
import { ConfirmDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { dataSize } from '@/ui/format'
import { Group, type GroupRow } from '@/ui/primitives'
import { Sheet } from '@/ui/sheets'
import { ebookFormat, useEbookDownloadFailed, useEbookProgress } from './ebook-row'

/** A recording as the book page names its source: narrator, format and bitrate. */
function recordingName(book: BookRecord) {
  return [book.abb.narrator, book.abb.format, book.abb.bitrate].filter(Boolean).join(' · ')
}

/**
 * The book page's row for what is kept on the phone, and the sheet it opens to manage it: the
 * audiobook to listen without a connection, and the e-books downloaded to read. The sheet
 * saves, stops and deletes each copy. An upload Hardcover does not know has no e-books, so its
 * sheet holds only the audiobook, and it has no row until it can play.
 */
export function useDownloads({
  hardcoverId,
  stream,
  recordings,
}: {
  hardcoverId: number | null
  /** The recording Listen plays, which can be kept once it is playable. */
  stream: BookRecord | null
  /** Every recording found for the book, to list others already kept. */
  recordings: BookRecord[]
}) {
  const { t, i18n } = useLingui()
  const { showFeedback } = useFeedback()
  const errorText = useErrorText()
  const failed = useEbookDownloadFailed()
  const progress = useEbookProgress()
  const offline = useOfflineBooks()
  const ebooks = useEbooks()
  const { workId, choice, finding, keep: keepEbook } = useWorkEbooks(hardcoverId ?? 0, false)
  const [open, setOpen] = useState(false)

  // A download asked to be deleted, with what was saved in it, until the listener confirms.
  const [deleting, setDeleting] = useState<
    { kind: 'audiobook'; id: string } | { kind: 'ebook'; md5: string } | null
  >(null)

  const keepable = stream?.tracks && stream.torrentId !== null ? stream : null

  // The recording Listen plays first, then others of the book still on the phone.
  const keptRecordings = [
    ...(keepable ? [keepable] : []),
    ...recordings.filter((book) => book.id !== keepable?.id && offline.has(book.id)),
  ]

  const readable = hardcoverId !== null

  // Only files the listener kept count as downloaded; a copy fetched to read is in the cache.
  const keptEbooks = [...ebooks.values()]
    .filter((ebook) => readable && ebook.workId === workId && ebook.kept)
    .sort((a, b) => (b.chosenAt ?? 0) - (a.chosenAt ?? 0) || b.addedAt - a.addedAt)

  const size = (bytes: number) => dataSize(bytes, i18n.locale)

  function percentOf(copy: OfflineBook, total: number) {
    return total > 0 ? Math.floor((copy.bytes / total) * 100) : 0
  }

  async function keep(bookId: string) {
    try {
      await keepOffline(bookId)
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    }
  }

  // Every row keeps the same parts in every state, the name above, the state below and one
  // button at its end, so starting or ending a download changes only their text and icons. The
  // leading icon says what the file is, and turns to a check once it is on the phone.
  // Compose reads a row's slots once and draws a row that gains or loses one afresh.

  function recordingRow(book: BookRecord): GroupRow {
    const copy = offline.get(book.id) ?? null
    const total = recordingBytes(book)
    const download = () => void keep(book.id)

    const downloadAction = {
      glyph: 'download' as const,
      description: t({
        message: 'Download the audiobook',
        comment: 'Downloads-sheet row saving the audiobook to listen without a connection',
      }),
      onPress: download,
    }

    const base = { key: book.id, label: recordingName(book) }

    if (copy?.status === 'done') {
      return {
        ...base,
        glyph: 'onPhone',
        value: size(copy.total || total),
        action: {
          glyph: 'delete',
          description: t({
            message: 'Delete download',
            comment: 'Deletes the downloaded copy of an audiobook or e-book from the phone',
          }),
          onPress: () => setDeleting({ kind: 'audiobook', id: book.id }),
        },
      }
    }

    if (copy?.status === 'downloading') {
      const percent = percentOf(copy, total)

      return {
        ...base,
        glyph: 'listen',
        value: t({
          message: `Downloading · ${percent}%`,
          comment: 'Downloads-sheet row while the audiobook downloads, with how far it has got',
        }),
        action: {
          glyph: 'clear',
          description: t({ message: 'Cancel download', comment: 'Stops an audiobook download' }),
          onPress: () => void removeOffline(book.id),
        },
      }
    }

    return {
      ...base,
      glyph: copy?.status === 'failed' ? 'warning' : 'listen',
      value:
        copy?.status === 'failed'
          ? t({
              message: 'Download failed',
              comment: 'Storage-sheet row when a download failed; its button tries again',
            })
          : size(total),
      action: downloadAction,
      onPress: download,
    }
  }

  /** A file of the book's e-book, on the phone or not yet. */
  function ebookRow(result: EbookResult): GroupRow {
    const ebook = ebooks.get(result.md5) ?? null

    // Downloaded directly; a file that cannot be had says so, and another can be chosen.
    const download = () => keepEbook.mutate(result, { onError: () => showFeedback(failed) })

    const base = {
      key: result.md5,
      label: [result.publisher, ebookFormat(result)].filter(Boolean).join(' · '),
    }

    // Deleting a download removes only the file; the place, highlights and notes stay.
    if (ebook?.kept && ebook.status === 'done') {
      return {
        ...base,
        glyph: 'onPhone',
        value: size(ebook.total),
        action: {
          glyph: 'delete',
          description: t({
            message: 'Delete download',
            comment: 'Deletes the downloaded copy of an audiobook or e-book from the phone',
          }),
          onPress: () => setDeleting({ kind: 'ebook', md5: ebook.md5 }),
        },
      }
    }

    if (ebook?.status === 'downloading') {
      return {
        ...base,
        glyph: 'read',
        value: progress(ebook) ?? undefined,
        action: {
          glyph: 'clear',
          description: t({ message: 'Cancel download', comment: 'Stops an e-book download' }),
          onPress: () => void removeEbookFile(ebook.md5),
        },
      }
    }

    return {
      ...base,
      glyph: ebook?.status === 'failed' ? 'warning' : 'read',
      value:
        ebook?.status === 'failed'
          ? t({
              message: 'Download failed',
              comment: 'Storage-sheet row when a download failed; its button tries again',
            })
          : (result.size ??
            t({
              message: 'Size unknown',
              comment: 'Storage-sheet e-book row when the site does not give the file size',
            })),
      action: {
        glyph: 'download',
        description: t({
          message: 'Download the e-book',
          comment: 'Downloads-sheet row saving the book’s e-book to read it offline',
        }),
        onPress: download,
      },
      onPress: download,
    }
  }

  // The file Read opens first, whether it is here or not, then others kept; keeping or deleting
  // one never moves the rows.
  const ebookFiles = [
    ...(choice ? [choice] : []),
    ...keptEbooks.filter((ebook) => ebook.md5 !== choice?.md5).map(ebookResultOf),
  ]

  const ebookRows: GroupRow[] =
    ebookFiles.length > 0
      ? ebookFiles.map(ebookRow)
      : [
          {
            key: 'ebook',
            glyph: 'read',
            label:
              finding === 'searching'
                ? t({
                    message: 'Finding e-books…',
                    comment: 'Row under the Read button while e-books of the book are looked up',
                  })
                : t({
                    message: 'No e-books found',
                    comment: 'Row under the Read button when the book has no e-books',
                  }),
            pending: finding === 'searching',
          },
        ]

  const audioRows: GroupRow[] =
    keptRecordings.length > 0
      ? keptRecordings.map(recordingRow)
      : [
          {
            key: 'recording',
            glyph: 'listen',
            label: t({
              message: 'No recording to download yet',
              comment: 'Storage-sheet row when the book has no playable recording to download',
            }),
          },
        ]

  const row: GroupRow | null =
    !readable && !keepable
      ? null
      : {
          key: 'downloads',
          glyph: 'size',
          label: t({
            message: 'Manage storage',
            comment:
              'Book page row opening the sheet that saves or deletes the audiobook and e-book on the phone',
          }),
          onPress: () => setOpen(true),
        }

  const sheet = (
    <>
      {open ? (
        <Sheet
          title={t({
            message: 'Storage',
            comment:
              'Title of the sheet that saves or deletes the audiobook and e-book on the phone',
          })}
          onDismiss={() => setOpen(false)}
        >
          {() => (
            <Column
              modifiers={[fillMaxWidth(), verticalScroll(), padding(16, 0, 16, 24)]}
              verticalArrangement={{ spacedBy: 20 }}
            >
              <Group
                title={t({
                  message: 'Audiobooks',
                  comment: 'Storage-sheet section of audiobook files',
                })}
                rows={audioRows}
              />
              {readable ? (
                <Group
                  title={t({
                    message: 'E-books',
                    comment: 'Storage-sheet section of e-book files',
                  })}
                  rows={ebookRows}
                />
              ) : null}
            </Column>
          )}
        </Sheet>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={
            deleting.kind === 'audiobook'
              ? t({ message: 'Delete this audiobook’s download?', comment: 'Dialog title' })
              : t({ message: 'Delete this e-book’s download?', comment: 'Dialog title' })
          }
          message={
            deleting.kind === 'audiobook'
              ? t({
                  message: 'Its progress and bookmarks are deleted too.',
                  comment: 'Warns that deleting an audiobook download deletes its saved data',
                })
              : t({
                  message: 'Its reading progress, highlights and notes are deleted too.',
                  comment: 'Warns that deleting an e-book download deletes its saved data',
                })
          }
          confirmLabel={t({ message: 'Delete', comment: 'Confirms deleting downloads' })}
          onConfirm={() =>
            void (deleting.kind === 'audiobook'
              ? deleteAudiobookDownload(deleting.id)
              : deleteEbookFile(deleting.md5))
          }
          onDismiss={() => setDeleting(null)}
        />
      ) : null}
    </>
  )

  /** Opens the storage sheet from elsewhere, such as a menu; null when there is nothing to keep. */
  const openStorage = !readable && !keepable ? null : () => setOpen(true)

  return { row, sheet, openStorage }
}
