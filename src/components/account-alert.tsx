import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Host } from '@/components/host'
import { type AccountProblem, useAccountProblems } from '@/settings/account-checks'
import { ConfirmDialog } from '@/ui/dialogs'

/**
 * Checks the saved accounts and proxy in the background when the app starts, and once they have
 * answered, says what needs fixing in one dialog that leads to Settings. It shows once per start.
 */
export function AccountAlert() {
  const { t } = useLingui()
  const router = useRouter()
  const problems = useAccountProblems()
  const [shown, setShown] = useState(false)
  const [open, setOpen] = useState(false)

  const describe: Record<AccountProblem, string> = {
    torBoxKey: t({
      message: 'TorBox no longer accepts your API key.',
      comment: 'Start-up check: the saved TorBox key was rejected',
    }),
    hardcoverKey: t({
      message: 'Hardcover no longer accepts your API key.',
      comment: 'Start-up check: the saved Hardcover key was rejected or lacks access',
    }),
    annasKey: t({
      message: 'Anna’s Archive no longer accepts your member key.',
      comment: 'Start-up check: the saved Anna’s Archive key was rejected',
    }),
    proxySignIn: t({
      message: 'The proxy no longer accepts your username and password.',
      comment: 'Start-up check: the saved proxy sign-in was rejected',
    }),
    proxyUnreachable: t({
      message: 'The proxy could not be reached.',
      comment: 'Start-up check: the saved proxy does not answer',
    }),
  }

  // Opened once, the first time the checks come back with something wrong.
  if (!shown && problems && problems.length > 0) {
    setShown(true)
    setOpen(true)
  }

  if (!open || !problems) {
    return null
  }

  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      <ConfirmDialog
        title={t({
          message: 'Check your settings',
          comment: 'Start-up account check dialog title',
        })}
        message={problems.map((problem) => describe[problem]).join('\n')}
        confirmLabel={t({ message: 'Open settings', comment: 'Start-up account check dialog' })}
        dismissLabel={t({ message: 'Later', comment: 'Start-up account check dialog' })}
        onConfirm={() => router.navigate('/settings')}
        onDismiss={() => setOpen(false)}
      />
    </Host>
  )
}
