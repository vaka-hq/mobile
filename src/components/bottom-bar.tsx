import { useLingui } from '@lingui/react/macro'
import { useTabTrigger } from 'expo-router/ui'
import { Host } from '@/components/host'
import { Column } from '@/lib/compose-ui'
import type { Glyph } from '@/ui/glyphs'
import { GlyphIcon } from '@/ui/primitives'
import { ShortNavigationBar } from '../../modules/ui'

type TabName = 'library' | 'browse'

type Tab = {
  name: TabName
  label: string
  icon: Glyph
  selectedIcon: Glyph
  focused: boolean
}

function TabIcon({ tab }: { tab: Tab }) {
  // The selected state shows the filled glyph.
  return <GlyphIcon glyph={tab.focused ? tab.selectedIcon : tab.icon} description={tab.label} />
}

/**
 * The Material 3 Expressive short navigation bar under the tabs; the mini player floats above it
 * in the player layer.
 */
export function BottomBar() {
  const { t } = useLingui()
  const libraryTrigger = useTabTrigger({ name: 'library' })
  const browseTrigger = useTabTrigger({ name: 'browse' })

  const library: Tab = {
    name: 'library',
    label: t({ message: 'Library', comment: 'Navigation destination: saved audiobooks' }),
    icon: 'library',
    selectedIcon: 'libraryFilled',
    focused: Boolean(libraryTrigger.trigger?.isFocused),
  }

  const browse: Tab = {
    name: 'browse',
    label: t({
      message: 'Browse',
      comment: 'Navigation destination: new and trending books, and searching for more',
    }),
    icon: 'browse',
    selectedIcon: 'browseFilled',
    focused: Boolean(browseTrigger.trigger?.isFocused),
  }

  const tabs = [library, browse]

  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
      <Column>
        <ShortNavigationBar
          labels={[library.label, browse.label]}
          icons={[
            <TabIcon key={library.name} tab={library} />,
            <TabIcon key={browse.name} tab={browse} />,
          ]}
          selectedIndex={Math.max(
            0,
            tabs.findIndex((tab) => tab.focused),
          )}
          onSelect={(index) => {
            const tab = tabs[index]

            if (tab && !tab.focused) {
              libraryTrigger.switchTab(tab.name, { resetOnFocus: false })
            }
          }}
        />
      </Column>
    </Host>
  )
}
