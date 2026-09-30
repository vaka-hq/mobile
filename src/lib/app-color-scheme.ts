import { useSyncExternalStore } from 'react'
import { Appearance, AppState, type ColorSchemeName } from 'react-native'

type AppColorScheme = 'dark' | 'light' | null

function normalizeColorScheme(colorScheme: ColorSchemeName | null | undefined): AppColorScheme {
  return colorScheme === 'dark' || colorScheme === 'light' ? colorScheme : null
}

function readColorScheme(): AppColorScheme {
  return normalizeColorScheme(Appearance.getColorScheme())
}

let currentColorScheme = readColorScheme()

let appearanceSubscription: ReturnType<typeof Appearance.addChangeListener> | null = null

let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null

let refreshTimers: Array<ReturnType<typeof setTimeout>> = []

const colorSchemeListeners = new Set<() => void>()

function publishColorScheme(nextColorScheme: AppColorScheme) {
  if (nextColorScheme === null || nextColorScheme === currentColorScheme) {
    return
  }

  currentColorScheme = nextColorScheme

  for (const listener of colorSchemeListeners) {
    listener()
  }
}

function clearRefreshTimers() {
  for (const timer of refreshTimers) {
    clearTimeout(timer)
  }

  refreshTimers = []
}

/**
 * Android can report the previous configuration for the first foreground callback after system
 * Settings closes. Confirm the value across the following frames so the whole retained stack moves
 * to one appearance even when React Native's first event was early or omitted.
 */
function scheduleColorSchemeRefresh() {
  clearRefreshTimers()

  for (const delay of [0, 50, 150, 300, 600]) {
    refreshTimers.push(
      setTimeout(() => {
        publishColorScheme(readColorScheme())
      }, delay),
    )
  }
}

function subscribeToColorScheme(listener: () => void) {
  colorSchemeListeners.add(listener)

  if (colorSchemeListeners.size === 1) {
    appearanceSubscription = Appearance.addChangeListener(({ colorScheme }) => {
      publishColorScheme(normalizeColorScheme(colorScheme))
      scheduleColorSchemeRefresh()
    })
    appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        scheduleColorSchemeRefresh()
      }
    })
    scheduleColorSchemeRefresh()
  }

  return () => {
    colorSchemeListeners.delete(listener)

    if (colorSchemeListeners.size === 0) {
      appearanceSubscription?.remove()
      appearanceSubscription = null
      appStateSubscription?.remove()
      appStateSubscription = null
      clearRefreshTimers()
    }
  }
}

function getColorSchemeSnapshot() {
  return currentColorScheme
}

/**
 * One shared appearance source keeps React Navigation, retained Compose hosts, and native-stack
 * transition colors on the same live value.
 */
export function useAppColorScheme() {
  return useSyncExternalStore(
    subscribeToColorScheme,
    getColorSchemeSnapshot,
    getColorSchemeSnapshot,
  )
}
