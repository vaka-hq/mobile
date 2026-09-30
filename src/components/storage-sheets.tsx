import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useFeedback } from '@/lib/feedback'
import { displayAuthors, displayTitle } from '@/library/display'
import { useEbooks } from '@/library/ebooks'
import { recordingBytes } from '@/library/model'
import { keepOffline, useOfflineBooks } from '@/library/offline'
import {
  deleteAudiobookDownload,
  deleteEbookFile,
  useDownloadedAudiobooks,
  useWorksOf,
} from '@/library/queries'
import { ConfirmDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { dataSize } from '@/ui/format'
import { CardItem, Crossfade, Empty } from '@/ui/primitives'
import { Action } from '@/ui/screen'
import { Sheet, SheetList, useOpenSheetBody } from '@/ui/sheets'

/** How far into an e-book counts as having read it, since its last page starts short of the end. */
const readToEnd = 0.98

/**
 * The audiobooks downloaded to the phone, each deletable, with deleting every finished one at
 * once from the title row. A download that failed says so, and tapping it tries again. Deleting
 * a download deletes its progress and bookmarks too; the book stays in the library and streams.
 */
export function AudiobookDownloadsSheet({ onDismiss }: { onDismiss: () => void }) {
  const { t, i18n } = useLingui()
  const errorText = useErrorText()
  const { showFeedback } = useFeedback()
  const offline = useOfflineBooks()
  const downloaded = useDownloadedAudiobooks().data ?? []
  const openBody = useOpenSheetBody()
  const [asking, setAsking] = useState(false)
  // The download asked to be deleted, until the listener confirms.
  const [deleting, setDeleting] = useState<string | null>(null)
  const shown = downloaded.filter((entry) => offline.has(entry.id))
  const finished = shown.filter((entry) => entry.finished)

  async function retry(bookId: string) {
    try {
      await keepOffline(bookId)
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    }
  }

  return (
    <>
      <Sheet
        title={t({
          message: 'Audiobooks',
          comment: 'Title of the sheet listing downloaded audiobooks',
        })}
        action={
          finished.length > 0 ? (
            <Action
              glyph='deleteFinished'
              label={t({
                message: 'Delete finished audiobooks',
                comment: 'Deletes the downloads of every finished audiobook',
              })}
              onPress={() => setAsking(true)}
            />
          ) : null
        }
        onDismiss={onDismiss}
      >
        {() => (
          <Crossfade
            showSecond={shown.length === 0}
            first={
              <SheetList minHeight={openBody}>
                {shown.map((entry, index) => {
                  const copy = offline.get(entry.id)
                  const total = copy?.total || (entry.book ? recordingBytes(entry.book) : 0)
                  const percent = total > 0 ? Math.floor(((copy?.bytes ?? 0) / total) * 100) : 0

                  const failed = copy?.status === 'failed'

                  return (
                    <CardItem
                      key={entry.id}
                      card={{ index, count: shown.length }}
                      leading={{
                        glyph: failed ? 'warning' : entry.finished ? 'finished' : 'listen',
                      }}
                      headline={entry.book ? displayTitle(entry.book) : entry.id}
                      supporting={[
                        entry.book ? displayAuthors(entry.book).join(', ') : null,
                        copy?.status === 'downloading'
                          ? t({
                              message: `Downloading · ${percent}%`,
                              comment:
                                'Downloads-sheet row while the audiobook downloads, with how far it has got',
                            })
                          : failed
                            ? t({
                                message: `Download failed at ${percent}%. Tap to try again.`,
                                comment:
                                  'Downloads-sheet row for an audiobook whose download failed, with how far it got',
                              })
                            : dataSize(total, i18n.locale),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      action={
                        <Action
                          glyph='delete'
                          label={t({
                            message: 'Delete download',
                            comment:
                              'Deletes the downloaded copy of an audiobook or e-book from the phone',
                          })}
                          onPress={() => setDeleting(entry.id)}
                        />
                      }
                      onPress={failed ? () => void retry(entry.id) : undefined}
                    />
                  )
                })}
              </SheetList>
            }
            second={
              <Empty
                glyph='listen'
                title={t({
                  message: 'No audiobooks downloaded',
                  comment: 'Empty sheet of downloaded audiobooks',
                })}
                height={Math.max(160, openBody)}
              />
            }
          />
        )}
      </Sheet>
      {asking ? (
        <ConfirmDialog
          title={t({ message: 'Delete finished audiobooks?', comment: 'Dialog title' })}
          message={t({
            message: 'Their progress and bookmarks are deleted too.',
            comment: 'Warns that deleting finished audiobook downloads deletes their saved data',
          })}
          confirmLabel={t({ message: 'Delete', comment: 'Confirms deleting downloads' })}
          onConfirm={() => {
            for (const entry of finished) {
              void deleteAudiobookDownload(entry.id)
            }
          }}
          onDismiss={() => setAsking(false)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={t({ message: 'Delete this audiobook’s download?', comment: 'Dialog title' })}
          message={t({
            message: 'Its progress and bookmarks are deleted too.',
            comment: 'Warns that deleting an audiobook download deletes its saved data',
          })}
          confirmLabel={t({ message: 'Delete', comment: 'Confirms deleting downloads' })}
          onConfirm={() => void deleteAudiobookDownload(deleting)}
          onDismiss={() => setDeleting(null)}
        />
      ) : null}
    </>
  )
}

/**
 * The e-books downloaded to the phone, each deletable, with deleting every one read to its end, or
 * of a book marked finished, at once from the title row. Deleting a file deletes its place,
 * highlights, notes and bookmarks too; reading it downloads it again.
 */
export function EbookDownloadsSheet({ onDismiss }: { onDismiss: () => void }) {
  const { t, i18n } = useLingui()
  const ebooks = useEbooks()
  const openBody = useOpenSheetBody()
  const [asking, setAsking] = useState(false)
  // The file asked to be deleted, until the listener confirms.
  const [deleting, setDeleting] = useState<string | null>(null)

  const shown = [...ebooks.values()]
    .filter((ebook) => ebook.kept)
    .sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))

  const works = useWorksOf([
    ...new Set(shown.flatMap((ebook) => (ebook.workId ? [ebook.workId] : []))),
  ]).data

  const isFinished = (ebook: (typeof shown)[number]) =>
    ebook.progress >= readToEnd || Boolean(ebook.workId && works?.get(ebook.workId)?.finishedAt)

  const finished = shown.filter(isFinished)

  return (
    <>
      <Sheet
        title={t({ message: 'E-books', comment: 'Title of the sheet listing downloaded e-books' })}
        action={
          finished.length > 0 ? (
            <Action
              glyph='deleteFinished'
              label={t({
                message: 'Delete finished e-books',
                comment: 'Deletes the files of every finished e-book',
              })}
              onPress={() => setAsking(true)}
            />
          ) : null
        }
        onDismiss={onDismiss}
      >
        {() => (
          <Crossfade
            showSecond={shown.length === 0}
            first={
              <SheetList minHeight={openBody}>
                {shown.map((ebook, index) => (
                  <CardItem
                    key={ebook.md5}
                    card={{ index, count: shown.length }}
                    leading={{ glyph: isFinished(ebook) ? 'finished' : 'read' }}
                    headline={ebook.title}
                    supporting={[
                      ebook.authors.join(', ') || null,
                      dataSize(ebook.total, i18n.locale),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    action={
                      <Action
                        glyph='delete'
                        label={t({
                          message: 'Delete download',
                          comment:
                            'Deletes the downloaded copy of an audiobook or e-book from the phone',
                        })}
                        onPress={() => setDeleting(ebook.md5)}
                      />
                    }
                  />
                ))}
              </SheetList>
            }
            second={
              <Empty
                glyph='read'
                title={t({
                  message: 'No e-books downloaded',
                  comment: 'Empty sheet of downloaded e-books',
                })}
                height={Math.max(160, openBody)}
              />
            }
          />
        )}
      </Sheet>
      {asking ? (
        <ConfirmDialog
          title={t({ message: 'Delete finished e-books?', comment: 'Dialog title' })}
          message={t({
            message: 'Their reading progress, highlights and notes are deleted too.',
            comment: 'Warns that deleting finished e-book downloads deletes their saved data',
          })}
          confirmLabel={t({ message: 'Delete', comment: 'Confirms deleting downloads' })}
          onConfirm={() => {
            for (const ebook of finished) {
              void deleteEbookFile(ebook.md5)
            }
          }}
          onDismiss={() => setAsking(false)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={t({ message: 'Delete this e-book’s download?', comment: 'Dialog title' })}
          message={t({
            message: 'Its reading progress, highlights and notes are deleted too.',
            comment: 'Warns that deleting an e-book download deletes its saved data',
          })}
          confirmLabel={t({ message: 'Delete', comment: 'Confirms deleting downloads' })}
          onConfirm={() => void deleteEbookFile(deleting)}
          onDismiss={() => setDeleting(null)}
        />
      ) : null}
    </>
  )
}
