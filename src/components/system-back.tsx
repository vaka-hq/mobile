import { usePathname } from 'expo-router'
import { useLayoutEffect } from 'react'
import { usePlayerLayout } from '@/player/expansion'
import { setReactNativeBack } from '../../modules/android-components'

/**
 * On the Library, the root screen, Android owns Back, so the system can animate back to the home
 * screen as it does in other apps. Anywhere else React Native keeps it, and so does the open full
 * player, which Back collapses.
 */
export function SystemBack() {
  const root = usePathname() === '/'
  const { expanded } = usePlayerLayout()
  const systemOwns = root && !expanded

  useLayoutEffect(() => {
    let frame: number | null = null

    const apply = () => {
      // The activity may not be attached during the first frames.
      if (!setReactNativeBack(!systemOwns)) {
        frame = requestAnimationFrame(apply)
      }
    }

    apply()

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }

      setReactNativeBack(true)
    }
  }, [systemOwns])

  return null
}
