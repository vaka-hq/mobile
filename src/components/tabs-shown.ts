import { usePathname, useRootNavigationState } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { onNativeDismissal } from '../../modules/ui'

const tabPaths = new Set(['/', '/browse'])

/**
 * Whether the tabs show, or are about to. A committed back swipe says so as it commits, while the
 * route changes only once its animation has ended, so what follows the tabs, such as the mini
 * player, moves with the screens, as it does when the back button is pressed.
 */
export function useTabsShown() {
  const pathname = usePathname()
  // The root navigator holds the app's stack, whose screen below the top one a swipe returns to.
  const root = useRootNavigationState()
  const stack = root.routes[root.index]?.state
  const top = stack ? (stack.index ?? stack.routes.length - 1) : 0
  const below = stack?.routes[top - 1]?.name ?? null
  const latest = useRef({ pathname, below })
  // The screen a committed swipe leaves, and whether the one it returns to is the tabs.
  const [returning, setReturning] = useState<{ from: string; toTabs: boolean } | null>(null)

  useEffect(() => {
    latest.current = { pathname, below }
  }, [pathname, below])

  useEffect(
    () =>
      onNativeDismissal(() =>
        setReturning({ from: latest.current.pathname, toTabs: latest.current.below === '(tabs)' }),
      ),
    [],
  )

  // Once the route has changed, it speaks for itself.
  useEffect(() => {
    setReturning((current) => (current && current.from !== pathname ? null : current))
  }, [pathname])

  return returning?.from === pathname ? returning.toTabs : tabPaths.has(pathname)
}
