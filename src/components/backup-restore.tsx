import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useFeedback } from '@/lib/feedback'
import { queryClient } from '@/lib/query-client'
import {
  type Backup,
  type BackupContents,
  BackupFormatError,
  pickBackup,
  type RestoreSummary,
  restoreBackup,
} from '@/library/backup'
import { ConfirmDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'

/**
 * Restoring a backup: `pick` asks for the file and shows what it holds, and restoring waits for
 * the listener to confirm; `dialog` goes in the screen's tree. `onRestored` follows a restore,
 * such as the welcome screen moving on.
 */
export function useBackupRestore(onRestored?: (summary: RestoreSummary) => void) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const { showFeedback } = useFeedback()
  // A backup picked to restore, shown with what it holds until the listener confirms.
  const [picked, setPicked] = useState<{ backup: Backup; contents: BackupContents } | null>(null)

  function failed(error: Error | null) {
    showFeedback(
      error instanceof BackupFormatError
        ? t({
            message: 'This file is not a Vaka backup',
            comment: 'The picked file could not be read as a backup',
          })
        : errorText(error),
    )
  }

  /** Reads the backup the listener picks, to show what it holds before anything changes. */
  async function pick() {
    try {
      setPicked(await pickBackup())
    } catch (error) {
      failed(error instanceof Error ? error : null)
    }
  }

  async function restore(backup: Backup) {
    try {
      const summary = await restoreBackup(backup)

      // Progress, bookmarks and notes of any book may have changed, not only the library.
      void queryClient.invalidateQueries()
      const books = summary.books

      showFeedback(
        t({
          message: plural(books, {
            one: 'Restored # book from the backup',
            other: 'Restored # books from the backup',
          }),
          comment: 'Backup restored, with how many library books it held',
        }),
      )
      onRestored?.(summary)
    } catch (error) {
      failed(error instanceof Error ? error : null)
    }
  }

  /** What a backup adds, a line for each kind of thing it holds. */
  function backupContents(contents: BackupContents) {
    const lines = [
      contents.books > 0
        ? t({
            message: plural(contents.books, { one: '# book', other: '# books' }),
            comment: 'Line in the restore dialog: books in the backup’s library',
          })
        : null,
      contents.bookmarks > 0
        ? t({
            message: plural(contents.bookmarks, { one: '# bookmark', other: '# bookmarks' }),
            comment: 'Line in the restore dialog: audiobook bookmarks in the backup',
          })
        : null,
      contents.ebooks > 0
        ? t({
            message: plural(contents.ebooks, { one: '# e-book', other: '# e-books' }),
            comment: 'Line in the restore dialog: e-books with their places in the backup',
          })
        : null,
      contents.notes > 0
        ? t({
            message: plural(contents.notes, {
              one: '# highlight or note',
              other: '# highlights and notes',
            }),
            comment: 'Line in the restore dialog: e-book highlights, notes and bookmarks',
          })
        : null,
      contents.series > 0
        ? t({
            message: plural(contents.series, { one: '# series', other: '# series' }),
            comment: 'Line in the restore dialog: followed series in the backup',
          })
        : null,
      contents.settings
        ? t({ message: 'Settings', comment: 'Line in the restore dialog: the app’s settings' })
        : null,
      contents.secrets
        ? t({
            message: 'Keys and passwords',
            comment: 'Line in the restore dialog: API keys and the proxy sign-in',
          })
        : null,
    ].filter((line) => line !== null)

    return lines.length > 0
      ? lines.join('\n')
      : t({ message: 'Nothing to add', comment: 'Restore dialog for an empty backup' })
  }

  const dialog = picked ? (
    <ConfirmDialog
      title={t({ message: 'Restore this backup?', comment: 'Dialog title' })}
      message={backupContents(picked.contents)}
      confirmLabel={t({ message: 'Restore', comment: 'Confirms restoring a backup' })}
      onConfirm={() => void restore(picked.backup)}
      onDismiss={() => setPicked(null)}
    />
  ) : null

  return { pick, dialog }
}
