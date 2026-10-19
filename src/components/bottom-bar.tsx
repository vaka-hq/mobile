import { useLingui } from '@lingui/react/macro'
import { useTabTrigger } from 'expo-router/ui'
import { Host } from '@/components/host'
import { Column, Icon } from '@/lib/compose-ui'
import { glyphs } from '@/ui/glyphs'
import { ShortNavigationBar } from '../../modules/ui'

type TabName = 'library' | 'browse'

type Tab = {
  name: TabName
  label: string
  icon: number
  selectedIcon: number
  focused: boolean
}

function TabIcon({ tab }: { tab: Tab }) {
  // The selected state shows the filled glyph.
  return (
    <Icon
      source={tab.focused ? tab.selectedIcon : tab.icon}
      size={24}
      contentDescription={tab.label}
    />
  )
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
    icon: glyphs.library,
    selectedIcon: glyphs.libraryFilled,
    focused: Boolean(libraryTrigger.trigger?.isFocused),
  }

  const browse: Tab = {
    name: 'browse',
    label: t({
      message: 'Browse',
      comment: 'Navigation destination: new and trending books, and searching for more',
    }),
    icon: glyphs.browse,
    selectedIcon: glyphs.browseFilled,
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
