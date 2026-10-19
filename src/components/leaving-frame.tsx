import { useNavigation, usePreventRemove } from 'expo-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { findNodeHandle, type HostInstance, View } from 'react-native'
import { freezeScreen, onNativeDismissal, takeNativeDismissal, thawScreen } from '../../modules/ui'

/** Long enough for any exit transition; a screen still here then was not removed after all. */
const leaveLimitMs = 1000

/**
 * A screen that keeps its last frame while the stack moves it away. React removes a closing
 * screen's views before its transition starts and its Compose content would redraw empty, so the
 * screen holds its removal until the frame is in place, then lets it go on. A screen a back swipe
 * dismisses natively is already drawn by the swipe, so it lets go at once.
 */
export function LeavingFrame({ children }: { children: ReactNode }) {
  const navigation = useNavigation()
  const frame = useRef<HostInstance>(null)
  // Held while the screen shows, and let go once its frame is kept.
  const [holding, setHolding] = useState(true)
  const removal = useRef<(() => void) | null>(null)

  usePreventRemove(holding, ({ repeat }) => {
    const tag = findNodeHandle(frame.current) ?? null

    const letGo = () => {
      removal.current = repeat
      setHolding(false)
    }

    // A predictive back has already taken the screen away natively; React only follows.
    if (tag === null || !navigation.isFocused() || takeNativeDismissal()) {
      letGo()

      return
    }

    void freezeScreen(tag).then(letGo)
  })

  // A back swipe dismisses the screen natively once its animation ends; holding the removal then
  // would leave the screen in the navigation state, so it lets go as the swipe commits.
  useEffect(
    () =>
      onNativeDismissal(() => {
        if (navigation.isFocused()) {
          setHolding(false)
        }
      }),
    [navigation],
  )

  // The removal goes on once the screen has stopped holding it.
  useEffect(() => {
    const repeat = removal.current

    if (holding || !repeat) {
      return
    }

    removal.current = null
    repeat()

    const timer = setTimeout(() => {
      const tag = findNodeHandle(frame.current) ?? null

      if (tag !== null) {
        thawScreen(tag)
      }

      setHolding(true)
    }, leaveLimitMs)

    return () => clearTimeout(timer)
  }, [holding])

  return (
    <View ref={frame} style={{ flex: 1 }} collapsable={false}>
      {children}
    </View>
  )
}
