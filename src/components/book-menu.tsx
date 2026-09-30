import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { DropdownMenu, DropdownMenuItem, Text } from '@/lib/compose-ui'
import { useFeedback } from '@/lib/feedback'
import { useEbooks } from '@/library/ebooks'
import type { WorkRecord } from '@/library/model'
import { useMarkWork } from '@/library/queries'
import type { HardcoverWork } from '@/sources/hardcover/client'
import { ConfirmDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { Action } from '@/ui/screen'

/**
 * The book page's overflow menu: manage what is kept on the phone, pick another book for a
 * recording matched to the wrong one, and mark the book finished, or as not started to begin
 * again, which asks first. `menu` goes in the app bar and `dialog` in the screen's tree.
 */
export function useBookMenu({
  workId,
  hardcover,
  record,
  onManageStorage,
  onChangeMatch,
}: {
  workId: string
  hardcover: HardcoverWork | null
  /** The book as the library knows it; null before it was ever saved or played. */
  record: WorkRecord | null
  /** Opens the sheet that keeps the book on the phone; null when there is nothing to keep. */
  onManageStorage: (() => void) | null
  /** Opens the match picker for the recording shown; null when there is none. */
  onChangeMatch?: (() => void) | null
}) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const { showFeedback } = useFeedback()
  const [open, setOpen] = useState(false)
  // The mark being confirmed: both lose the listening place.
  const [asking, setAsking] = useState<'finished' | 'notStarted' | null>(null)
  const mark = useMarkWork(workId, hardcover)
  const finished = record?.finishedAt != null

  // Read counts as started as much as listened to.
  const read = [...useEbooks().values()].some(
    (ebook) => ebook.workId === workId && (ebook.lastReadAt !== null || ebook.progress > 0),
  )

  const started = record?.lastPlayedAt != null || read

  const menu = (
    <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
      <DropdownMenu.Trigger>
        <Action
          glyph='more'
          label={t({ message: 'More options', comment: 'Opens a book’s menu in the library' })}
          onPress={() => setOpen(true)}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Items>
        {onManageStorage ? (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              onManageStorage()
            }}
          >
            <DropdownMenuItem.Text>
              <Text>
                {t({
                  message: 'Manage storage',
                  comment:
                    'Book page menu item opening the sheet that saves or deletes the audiobook and e-book on the phone',
                })}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ) : null}
        {onChangeMatch ? (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              onChangeMatch()
            }}
          >
            <DropdownMenuItem.Text>
              <Text>
                {t({
                  message: 'Wrong book?',
                  comment:
                    'Book page menu item opening the picker to match the recording to another book',
                })}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ) : null}
        {!finished ? (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              setAsking('finished')
            }}
          >
            <DropdownMenuItem.Text>
              <Text>
                {t({ message: 'Mark as finished', comment: 'Library and book menu action' })}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ) : null}
        {finished || started ? (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              setAsking('notStarted')
            }}
          >
            <DropdownMenuItem.Text>
              <Text>
                {t({
                  message: 'Mark as not started',
                  comment: 'Library and book menu action that forgets all progress',
                })}
              </Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenu.Items>
    </DropdownMenu>
  )

  const dialog = asking ? (
    <ConfirmDialog
      title={
        asking === 'finished'
          ? t({ message: 'Mark as finished?', comment: 'Dialog title' })
          : t({ message: 'Mark as not started?', comment: 'Dialog title' })
      }
      message={t({
        message: 'You’ll lose your progress.',
        comment:
          'Warns that marking a book finished or not started resets where listening and reading stopped',
      })}
      confirmLabel={
        asking === 'finished'
          ? t({ message: 'Finish', comment: 'Confirms marking a book finished' })
          : t({ message: 'Start over', comment: 'Confirms marking a book not started' })
      }
      onConfirm={() => mark.mutate(asking, { onError: (error) => showFeedback(errorText(error)) })}
      onDismiss={() => setAsking(null)}
    />
  ) : null

  return { menu, dialog }
}
