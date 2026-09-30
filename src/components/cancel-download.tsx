import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useFeedback } from '@/lib/feedback'
import { useCancelDownload } from '@/library/queries'
import { ConfirmDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'

/**
 * Asks before stopping a TorBox download, since what it has fetched is lost. `ask` opens the
 * question for a stream; `dialog` goes in the screen's tree.
 */
export function useCancelDownloadPrompt() {
  const { t } = useLingui()
  const { showFeedback } = useFeedback()
  const errorText = useErrorText()
  const cancel = useCancelDownload()
  const [bookId, setBookId] = useState<string | null>(null)

  const dialog = bookId ? (
    <ConfirmDialog
      title={t({ message: 'Cancel the download?', comment: 'Dialog title' })}
      message={t({
        message: 'What has downloaded so far is lost.',
        comment: 'Explains cancelling a download',
      })}
      // Short labels, so both buttons fit on one row.
      confirmLabel={t({ message: 'Cancel', comment: 'Confirms cancelling a download' })}
      dismissLabel={t({ message: 'Keep', comment: 'Keeps the download going' })}
      onConfirm={() =>
        cancel.mutate(bookId, { onError: (error) => showFeedback(errorText(error)) })
      }
      onDismiss={() => setBookId(null)}
    />
  ) : null

  return { ask: setBookId, cancelling: cancel.isPending, dialog }
}
