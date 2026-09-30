import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Host } from '@/components/host'
import { useAbbSilent } from '@/library/abb-reader'
import { useAbbProxy } from '@/settings/abb-proxy'
import { setPreference, usePreferences } from '@/settings/preferences'
import { ConfirmDialog } from '@/ui/dialogs'

/**
 * Says once that AudioBookBay has stopped answering, when it goes silent on direct requests: it
 * blocks addresses that ask too often, for up to a few days. It is said again only after
 * AudioBookBay has answered in between; with a proxy saved it never shows.
 */
export function AbbSilenceAlert() {
  const { t } = useLingui()
  const router = useRouter()
  const silent = useAbbSilent()
  const proxy = useAbbProxy()
  const { abbSilenceNoticed } = usePreferences()
  const [open, setOpen] = useState(false)

  if (silent && !proxy && !abbSilenceNoticed && !open) {
    setOpen(true)
    void setPreference('abbSilenceNoticed', true)
  }

  if (!open) {
    return null
  }

  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      <ConfirmDialog
        title={t({
          message: 'AudioBookBay isn’t answering',
          comment: 'Dialog title when AudioBookBay stops answering, likely blocking the phone',
        })}
        message={t({
          message:
            'It may have blocked your connection for making too many requests. Blocks usually last up to three days. A proxy in Settings gets around it.',
          comment: 'Dialog explaining that AudioBookBay may have blocked or rate limited the phone',
        })}
        confirmLabel={t({
          message: 'Open settings',
          comment: 'Opens Settings to set up a proxy for AudioBookBay',
        })}
        dismissLabel={t({ message: 'OK', comment: 'Closes an information dialog' })}
        onConfirm={() => router.navigate('/settings')}
        onDismiss={() => setOpen(false)}
      />
    </Host>
  )
}
