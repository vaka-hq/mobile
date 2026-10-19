import { useLingui } from '@lingui/react/macro'
import { usePathname, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Host } from '@/components/host'
import { useTabsShown } from '@/components/tabs-shown'
import { AnimatedVisibility, Column, EnterTransition, ExitTransition } from '@/lib/compose-ui'
import { setTabBarHeight } from '@/player/expansion'
import type { Glyph } from '@/ui/glyphs'
import { GlyphIcon } from '@/ui/primitives'
import { ShortNavigationBar } from '../../modules/ui'

type TabName = 'library' | 'browse'

const tabPaths: Record<TabName, '/' | '/browse'> = { library: '/', browse: '/browse' }

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
 * in the player layer. It floats above the stack rather than in the tabs' screen, so screens slide
 * past it without it: it slides away as another screen opens over the tabs and back as they
 * return, and the tabs keep room for it.
 */
export function BottomBar() {
  const { t } = useLingui()
  const router = useRouter()
  const pathname = usePathname()
  const shown = useTabsShown()
  // The tab shown last stays selected while the bar slides away under another screen.
  const [current, setCurrent] = useState<TabName>(pathname === '/browse' ? 'browse' : 'library')

  useEffect(() => {
    if (pathname === tabPaths.library || pathname === tabPaths.browse) {
      setCurrent(pathname === tabPaths.browse ? 'browse' : 'library')
    }
  }, [pathname])

  const library: Tab = {
    name: 'library',
    label: t({ message: 'Library', comment: 'Navigation destination: saved audiobooks' }),
    icon: 'library',
    selectedIcon: 'libraryFilled',
    focused: current === 'library',
  }

  const browse: Tab = {
    name: 'browse',
    label: t({
      message: 'Browse',
      comment: 'Navigation destination: new and trending books, and searching for more',
    }),
    icon: 'browse',
    selectedIcon: 'browseFilled',
    focused: current === 'browse',
  }

  const tabs = [library, browse]

  return (
    <View
      pointerEvents='box-none'
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
      // Measured while shown; the mini player sits above it and the tabs keep room for it.
      onLayout={(event) => {
        const { height } = event.nativeEvent.layout

        if (height > 0) {
          setTabBarHeight(height)
        }
      }}
    >
      <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
        <Column>
          <AnimatedVisibility
            visible={shown}
            enterTransition={EnterTransition.fadeIn().plus(
              EnterTransition.slideInVertically({ initialOffsetY: 1 }),
            )}
            exitTransition={ExitTransition.fadeOut().plus(
              ExitTransition.slideOutVertically({ targetOffsetY: 1 }),
            )}
          >
            <ShortNavigationBar
              labels={[library.label, browse.label]}
              icons={[
                <TabIcon key={library.name} tab={library} />,
                <TabIcon key={browse.name} tab={browse} />,
              ]}
              selectedIndex={current === 'browse' ? 1 : 0}
              onSelect={(index) => {
                const tab = tabs[index]

                if (tab && !tab.focused) {
                  router.navigate(tabPaths[tab.name])
                }
              }}
            />
          </AnimatedVisibility>
        </Column>
      </Host>
    </View>
  )
}
