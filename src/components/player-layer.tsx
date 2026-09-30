import { usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { BackHandler, StyleSheet } from 'react-native'
import { Host } from '@/components/host'
import { MiniPlayer } from '@/components/mini-player'
import {
  collapsePlayer,
  miniPlayerHeight,
  playerFaded,
  useBelowMiniPlayer,
  usePlayerLayout,
} from '@/player/expansion'
import { usePlayerValue } from '@/player/use-player'
import { PlayerContent } from '@/screens/player'
import { ExpandingPlayer } from '../../modules/android-components'

const tabPaths = new Set(['/', '/browse'])

/**
 * The mini player and the full player, floating above every route as one native surface. The
 * bar sits above the tab bar on the tabs and at the foot of pushed screens; expanding grows it
 * over everything, the tab bar included. The layer always fills the window so the bar never
 * jumps between sizes of it; touches outside the bar reach the screen below, since nothing in the
 * transparent rest of the layer takes them.
 */
export function PlayerLayer() {
  const pathname = usePathname()
  const loaded = usePlayerValue((state) => state.book !== null)
  const { expanded, tabBarHeight, starting, entrance, vanishing } = usePlayerLayout()
  const onTabs = tabPaths.has(pathname)

  // On the tabs the bar waits for the tab bar's height, so it never flashes over the tab bar.
  // The welcome screens and the reader have the whole screen to themselves.
  // Going to the reader, the player fades out with the screen's transition and only then goes, so
  // it is never seen to vanish while the page it sat on is still showing.
  const onReader = pathname.startsWith('/read/')
  const [fadedForReader, setFadedForReader] = useState(false)

  useEffect(() => {
    if (!onReader) {
      setFadedForReader(false)
    }
  }, [onReader])

  const hidden =
    !loaded ||
    starting ||
    pathname === '/welcome' ||
    (onReader && fadedForReader) ||
    (onTabs && tabBarHeight === 0)

  const belowMiniPlayer = useBelowMiniPlayer()
  // On screens without a tab bar, the bar rests clear of the screen's corners, filled below.
  const belowBar = onTabs ? 0 : belowMiniPlayer

  // Registered while open, after the router's own handler, so back collapses the player first.
  useEffect(() => {
    if (!expanded || hidden) {
      return
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      collapsePlayer()

      return true
    })

    return () => subscription.remove()
  }, [expanded, hidden])

  // Nothing to play, nothing to show; an open player closes with its book.
  useEffect(() => {
    if (!loaded) {
      collapsePlayer()
    }
  }, [loaded])

  if (hidden) {
    return null
  }

  // After playback starts from a book's page the layer is new and already open; the player fades
  // in as it first draws, whether open or as the mini player.
  return (
    <Host key={entrance} style={StyleSheet.absoluteFill}>
      <ExpandingPlayer
        expanded={expanded}
        collapsedHeight={miniPlayerHeight}
        collapsedBottomOffset={onTabs ? tabBarHeight : belowBar}
        collapsedFill={belowBar}
        vanishing={vanishing || onReader}
        onFaded={(shown) => {
          playerFaded(shown)

          if (!shown && onReader) {
            setFadedForReader(true)
          }
        }}
        collapsed={<MiniPlayer />}
        expandedContent={<PlayerContent showsFeedback={expanded} />}
      />
    </Host>
  )
}
