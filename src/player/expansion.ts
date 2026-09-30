import { useSyncExternalStore } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { bottomCornerRadius } from '../../modules/android-components'

/** The mini player bar: a 2 dp progress line over a 48 dp cover with 8 dp above and below. */
export const miniPlayerHeight = 66

/** Space between the bottom of the mini player's cover and the bottom of the bar. */
const miniPlayerCoverInset = 8

/** The least room above the system navigation bar, for phones with square or small corners. */
const minimumLift = 8

let cornerRadius: number | null = null

/** The screen's bottom corner radius, read once Android can report it. */
function screenCornerRadius() {
  if (cornerRadius === null) {
    const radius = bottomCornerRadius()

    // Zero until the activity is attached; asked again next time rather than remembered.
    if (radius > 0) {
      cornerRadius = radius
    }

    return radius
  }

  return cornerRadius
}

/**
 * How far the mini player rests above the bottom of the screen where no tab bar is below it,
 * filled in the bar's colour. The cover's bottom sits at the height where the screen's corner curve
 * begins, so the curve stays as far from the cover as the side edge does; never closer to the
 * system navigation bar than a small margin.
 */
export function useBelowMiniPlayer() {
  const insets = useSafeAreaInsets()
  const coverAtCorner = screenCornerRadius() - miniPlayerCoverInset

  return Math.max(insets.bottom + minimumLift, coverAtCorner)
}

/** The shared key of the cover that travels between the mini player and the full player. */
export const playerCoverKey = 'player-cover'

type Layout = {
  /** The full player is open, grown out of the mini player. */
  expanded: boolean
  /** The tab bar's height, which the mini player sits above on the tab destinations. */
  tabBarHeight: number
  /**
   * Playback is being started from a book's page: the player stays out of sight while the book
   * loads and the listener is asked where to start, then fades in already open.
   */
  starting: boolean
  /** Counts the times the player faded in open, so each one is a fresh, unanimated player. */
  entrance: number
  /**
   * The player is fading in open: screens make room for the mini player only once it covers
   * them, so the page does not shift in view.
   */
  revealing: boolean
  /** The player is fading out as it is closed. */
  vanishing: boolean
}

let layout: Layout = {
  expanded: false,
  tabBarHeight: 0,
  starting: false,
  entrance: 0,
  revealing: false,
  vanishing: false,
}

/**
 * The longest a fade is waited for, in ms, should the player never say it finished, such as when
 * it is taken away first.
 */
const fadeTimeout = 4000

let revealTimer: ReturnType<typeof setTimeout> | null = null

let vanished: (() => void) | null = null

const listeners = new Set<() => void>()

function update(patch: Partial<Layout>) {
  layout = { ...layout, ...patch }

  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Grows the mini player into the full player. */
export function expandPlayer() {
  if (!layout.expanded) {
    update({ expanded: true })
  }
}

/** Keeps the player out of sight while playback is started from a book's page. */
export function beginStarting() {
  update({ starting: true })
}

/**
 * Shows the full player at once, fading in over the screen, without the mini player growing into
 * it: for playback just started from a book's page.
 */
export function fadeInPlayer() {
  update({ starting: false, expanded: true, entrance: layout.entrance + 1, revealing: true })

  if (revealTimer) {
    clearTimeout(revealTimer)
  }

  // Ended when the player says it has faded in, or at the latest after a while.
  revealTimer = setTimeout(() => playerFaded(true), fadeTimeout)
}

/**
 * The player finished a fade: in, so what lies behind it may change now that it is covered; or
 * out, so it may be taken away.
 */
export function playerFaded(shown: boolean) {
  if (shown && layout.revealing) {
    if (revealTimer) {
      clearTimeout(revealTimer)
      revealTimer = null
    }

    update({ revealing: false })
  }

  if (!shown) {
    vanished?.()
    vanished = null
  }
}

/** Ends a start that did not play, such as one the listener cancelled; the mini player shows. */
export function endStarting() {
  if (layout.starting) {
    update({ starting: false })
  }
}

/**
 * Fades the player out, open or as the mini player, then runs `close`, which takes the book away,
 * so the player never vanishes in a single frame.
 */
export async function fadeOutPlayer(close: () => Promise<void>) {
  const faded = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, fadeTimeout)

    vanished = () => {
      clearTimeout(timeout)
      resolve()
    }
  })

  update({ vanishing: true })
  await faded

  try {
    await close()
  } finally {
    update({ vanishing: false, expanded: false })
  }
}

/** Shrinks the full player back into the mini player. */
export function collapsePlayer() {
  if (layout.expanded) {
    update({ expanded: false })
  }
}

export function setTabBarHeight(height: number) {
  if (height !== layout.tabBarHeight) {
    update({ tabBarHeight: height })
  }
}

export function usePlayerLayout() {
  return useSyncExternalStore(subscribe, () => layout)
}
