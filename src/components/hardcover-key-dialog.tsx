import { useLingui } from '@lingui/react/macro'
import { useFeedback } from '@/lib/feedback'
import { connectHardcover } from '@/settings/account-checks'
import { useKeyProblems } from '@/settings/key-problems'
import { TextDialog } from '@/ui/dialogs'

/**
 * Asks for a Hardcover API key, checks it before keeping it, and once it is kept closes and says
 * which account it connected, wherever it was opened from.
 */
export function HardcoverKeyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLingui()
  const { showFeedback } = useFeedback()
  const problems = useKeyProblems()

  /** Resolves with a problem to show in the dialog, or null once the key is saved. */
  async function save(value: string) {
    try {
      const account = await connectHardcover(value)

      onClose()
      showFeedback(
        account?.email
          ? t({
              message: `Connected to Hardcover as ${account.email}`,
              comment: 'Hardcover key saved, with the account email',
            })
          : t({ message: 'Connected to Hardcover', comment: 'Hardcover key saved' }),
      )

      return null
    } catch (error) {
      return problems.hardcover(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return (
    <TextDialog
      title={t({ message: 'Hardcover API key', comment: 'Dialog title' })}
      label={t({ message: 'API key', comment: 'Text field label' })}
      initialValue=''
      secret
      confirmLabel={t({ message: 'Save', comment: 'Saves a setting' })}
      onConfirm={save}
      onDismiss={onClose}
    />
  )
}
