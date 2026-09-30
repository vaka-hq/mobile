import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useSetWorkInLibrary } from '@/library/queries'
import type { HardcoverWork } from '@/sources/hardcover/client'
import { ConfirmDialog } from '@/ui/dialogs'

/** What removing a book from the library asks first, since its progress goes with it. */
export function useRemovalQuestion() {
  const { t } = useLingui()

  return {
    title: t({ message: 'Remove from library?', comment: 'Dialog title' }),
    message: t({
      message: 'You’ll lose your progress, notes and downloads.',
      comment:
        'Warns that removing a book from the library forgets where listening and reading stopped, and its bookmarks',
    }),
    confirmLabel: t({ message: 'Remove', comment: 'Confirms removing a book from the library' }),
  }
}

/**
 * Adds a book to the library at once, or asks before removing it. `dialog` goes in the screen's
 * tree.
 */
export function useLibraryToggle(workId: string, hardcover: HardcoverWork | null) {
  const setInLibrary = useSetWorkInLibrary(workId, hardcover)
  const question = useRemovalQuestion()
  const [asking, setAsking] = useState(false)

  function toggle(inLibrary: boolean) {
    if (inLibrary) {
      setAsking(true)
    } else {
      setInLibrary.mutate(true)
    }
  }

  const dialog = asking ? (
    <ConfirmDialog
      {...question}
      onConfirm={() => setInLibrary.mutate(false)}
      onDismiss={() => setAsking(false)}
    />
  ) : null

  return { toggle, dialog }
}
