import { useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import licenses from '@/about/licenses.json'
import { Group, LicenseText, List } from '@/ui/primitives'
import { Screen } from '@/ui/screen'
import { Sheet } from '@/ui/sheets'

type License = (typeof licenses)[number]

/** The open-source packages Vaka is built on; each opens its licence text. */
export function LicensesScreen() {
  const { t } = useLingui()
  const [open, setOpen] = useState<License | null>(null)

  return (
    <Screen
      title={t({
        message: 'Licenses',
        comment: 'Title of the screen listing the open-source packages and their licenses',
      })}
      navigation='back'
      collapseOnScroll
    >
      <List grouped bottomPadding={32}>
        <Group
          rows={licenses.map((license) => ({
            key: license.name,
            label: license.name,
            value: [license.version, license.license].filter(Boolean).join(' · '),
            onPress: () => setOpen(license),
          }))}
        />
      </List>
      {open ? (
        <Sheet title={open.name} onDismiss={() => setOpen(null)}>
          {() => {
            const name = open.license ?? ''

            return (
              <LicenseText
                text={
                  open.text ??
                  t({
                    message: `Released under the ${name} licence. The package includes no licence text.`,
                    comment:
                      'Shown for a package without a licence file; the licence is a name like MIT',
                  })
                }
              />
            )
          }}
        </Sheet>
      ) : null}
    </Screen>
  )
}
