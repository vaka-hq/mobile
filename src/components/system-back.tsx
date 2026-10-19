import { usePathname } from 'expo-router'
import { useLayoutEffect } from 'react'
import { usePlayerLayout } from '@/player/expansion'
import { setBackPreviewBlocked, setReactNativeBack } from '../../modules/android-components'

let blockers = 0

/**
 * While `active`, a back swipe shows no preview of the stack screen below: for wherever a
 * `BackHandler` takes Back for itself, which a committed preview would skip by closing the screen.
 */
export function useBackPreviewBlocked(active: boolean) {
  useLayoutEffect(() => {
    if (!active) {
      return
    }

    blockers += 1
    setBackPreviewBlocked(true)

    return () => {
      blockers -= 1
      setBackPreviewBlocked(blockers > 0)
    }
  }, [active])
}

/**
 * On the Library, the root screen, Android owns Back, so the system can animate back to the home
 * screen as it does in other apps. Anywhere else React Native keeps it, and so does the open full
 * player, which Back collapses. A back swipe on a pushed screen previews the one below.
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
