import { useNavigation } from 'expo-router'
import { type ReactNode, useEffect, useRef } from 'react'
import { findNodeHandle, View } from 'react-native'
import { freezeScreen, takeNativeDismissal, thawScreen } from '../../modules/android-components'

/** Long enough for any exit transition; a screen still here then was not removed after all. */
const leaveLimitMs = 1000

/**
 * A screen that keeps its last frame while the stack moves it away. React removes a closing
 * screen's views before its transition starts and its Compose content would redraw empty, so the
 * frame is put in place first and the removal goes on as soon as it is.
 */
export function LeavingFrame({ children }: { children: ReactNode }) {
  const navigation = useNavigation()
  const frame = useRef<View>(null)
  const leaving = useRef(false)

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        const tag = findNodeHandle(frame.current)

        if (leaving.current || tag === null || !navigation.isFocused()) {
          return
        }

        // A predictive back has already taken the screen away natively; React only follows.
        if (takeNativeDismissal()) {
          return
        }

        event.preventDefault()
        leaving.current = true

        void freezeScreen(tag).then(() => {
          navigation.dispatch(event.data.action)
          setTimeout(() => {
            leaving.current = false
            thawScreen(tag)
          }, leaveLimitMs)
        })
      }),
    [navigation],
  )

  return (
    <View ref={frame} style={{ flex: 1 }} collapsable={false}>
      {children}
    </View>
  )
}
