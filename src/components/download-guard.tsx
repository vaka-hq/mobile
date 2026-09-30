import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useFeedback } from '@/lib/feedback'
import { queryClient } from '@/lib/query-client'
import { type ActiveDownload, activeDownloads, cancelDownloads } from '@/library/books'
import { ConfirmDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'

/**
 * TorBox downloads one torrent at a time. Before a new download starts, `guard` looks for one
 * already running and, if there is, asks whether to cancel it for the new one; `dialog` goes in
 * the screen's tree for that question. Streams TorBox has cached start at once and are not asked
 * about.
 */
export function useDownloadGuard() {
  const { t } = useLingui()
  const { showFeedback } = useFeedback()
  const errorText = useErrorText()
  const [checking, setChecking] = useState(false)

  const [pending, setPending] = useState<{ others: ActiveDownload[]; start: () => void } | null>(
    null,
  )

  /**
   * Runs `start` now, or once the listener agrees to replace the download in progress. `hash` is
   * the torrent about to be downloaded, which does not count as another download.
   */
  async function guard(needsDownload: boolean, hash: string, start: () => void) {
    if (!needsDownload) {
      start()

      return
    }

    setChecking(true)

    try {
      const others = (await activeDownloads()).filter(
        (download) => download.hash.toLowerCase() !== hash.toLowerCase(),
      )

      if (others.length === 0) {
        start()
      } else {
        setPending({ others, start })
      }
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    } finally {
      setChecking(false)
    }
  }

  async function replace(others: ActiveDownload[], start: () => void) {
    setChecking(true)

    try {
      await cancelDownloads(others)
      void queryClient.invalidateQueries({ queryKey: ['torbox'] })
      start()
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    } finally {
      setChecking(false)
    }
  }

  const names = (pending?.others ?? []).map((other) => `“${other.name}”`).join(', ')
  const count = pending?.others.length ?? 0

  const dialog = pending ? (
    <ConfirmDialog
      title={t({ message: 'Replace the download?', comment: 'Dialog title' })}
      message={
        count === 1
          ? t({
              message: `Only one source downloads at a time, and ${names} is downloading now. Cancel it and download this one instead?`,
              comment:
                'Asks to replace the TorBox download in progress; the name is a torrent’s title in quotes',
            })
          : t({
              message: `Only one source downloads at a time, and these are downloading now: ${names}. Cancel them and download this one instead?`,
              comment:
                'Asks to replace several TorBox downloads in progress; the names are torrent titles in quotes, separated by commas',
            })
      }
      confirmLabel={t({ message: 'Replace', comment: 'Cancels one download for another' })}
      dismissLabel={t({ message: 'Keep', comment: 'Keeps the download in progress' })}
      onConfirm={() => void replace(pending.others, pending.start)}
      onDismiss={() => setPending(null)}
    />
  ) : null

  return { guard, checking, dialog }
}
