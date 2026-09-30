import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { Host } from '@/components/host'
import {
  allowInstallingUpdates,
  canInstallUpdates,
  checkForUpdates,
  closeUpdateDialog,
  declineUpdate,
  installUpdate,
  type UpdateProblem,
  useUpdateDialogOpen,
  useUpdateState,
} from '@/library/app-updates'
import { StatusDialog } from '@/ui/dialogs'

/**
 * Offers a newer build of the app and installs it: downloading it with its progress, then handing
 * it to Android, which asks the listener to confirm. The first time, Android must be told the app
 * may install apps; the setting opens, and the listener comes back to tap Update again.
 */
export function UpdateAlert() {
  const { t, i18n } = useLingui()
  const state = useUpdateState()
  const open = useUpdateDialogOpen()
  const [askedPermission, setAskedPermission] = useState(false)

  if (!open || state.phase === 'idle' || state.phase === 'checking' || state.phase === 'current') {
    return null
  }

  function update() {
    if (canInstallUpdates()) {
      setAskedPermission(false)
      void installUpdate()
    } else {
      setAskedPermission(true)
      allowInstallingUpdates()
    }
  }

  const problems: Record<UpdateProblem, string> = {
    check: t({
      message: 'Couldn’t check for updates. Check your connection and try again.',
      comment: 'Update dialog when the releases could not be read',
    }),
    download: t({
      message: 'The update couldn’t be downloaded. Check your connection and try again.',
      comment: 'Update dialog when downloading the new version failed',
    }),
    checksum: t({
      message: 'The downloaded update was damaged, so it wasn’t installed. Try again.',
      comment: 'Update dialog when the downloaded file did not match its checksum',
    }),
    install: t({
      message: 'Android couldn’t install the update.',
      comment: 'Update dialog when the system installer failed',
    }),
  }

  const later = t({ message: 'Later', comment: 'Puts off installing an update' })
  const close = t({ message: 'Close', comment: 'Closes an information dialog' })

  const dialog =
    state.phase === 'available' ? (
      <StatusDialog
        title={t({ message: 'Update available', comment: 'Dialog title offering a new version' })}
        message={
          askedPermission
            ? t({
                message: `Allow Vaka to install apps in the setting that opened, then come back and tap Update to install ${state.update.versionName}.`,
                comment:
                  'Update dialog after opening the system setting that lets the app install its update',
              })
            : t({
                message: `Vaka ${state.update.versionName} is ready to install.`,
                comment: 'Update dialog offering a new version, with its version name',
              })
        }
        confirmLabel={t({ message: 'Update', comment: 'Downloads and installs the new version' })}
        dismissLabel={later}
        onConfirm={update}
        onDismiss={declineUpdate}
      />
    ) : state.phase === 'downloading' ? (
      <StatusDialog
        title={t({ message: 'Downloading update', comment: 'Dialog title while downloading' })}
        message={t({
          message: `${i18n.number(state.progress, { style: 'percent' })} of Vaka ${state.update.versionName}`,
          comment: 'Update download progress: the share done, and the version name',
        })}
        progress={state.progress}
        dismissLabel={t({ message: 'Cancel', comment: 'Closes a dialog without changes' })}
        onDismiss={closeUpdateDialog}
      />
    ) : state.phase === 'installing' ? (
      <StatusDialog
        title={t({ message: 'Installing update', comment: 'Dialog title while installing' })}
        message={t({
          message: 'Vaka restarts once Android has installed it.',
          comment: 'Update dialog while the system installs the new version',
        })}
        busy
        dismissLabel={close}
        onDismiss={closeUpdateDialog}
      />
    ) : (
      <StatusDialog
        title={t({ message: 'Update failed', comment: 'Dialog title when an update failed' })}
        message={problems[state.problem]}
        confirmLabel={t({ message: 'Try again', comment: 'Retries a failed update' })}
        dismissLabel={close}
        onConfirm={() => (state.update ? update() : void checkForUpdates({ asked: true }))}
        onDismiss={closeUpdateDialog}
      />
    )

  return <Host style={{ position: 'absolute', width: 1, height: 1 }}>{dialog}</Host>
}
