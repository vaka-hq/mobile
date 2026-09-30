import { getMaterialColors, Host as ExpoHost } from '@expo/ui/jetpack-compose'
import { type ComponentProps, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { useAppColorScheme } from '@/lib/app-color-scheme'

type AndroidHostProps = ComponentProps<typeof ExpoHost>

type MaterialColorScheme = 'dark' | 'light'

type PaletteSignatures = Record<MaterialColorScheme, string | null>

let paletteRevision = 0

let paletteSignatures: PaletteSignatures | null = null

let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null

const paletteListeners = new Set<() => void>()

function materialPaletteSignature(colorScheme: MaterialColorScheme) {
  try {
    return JSON.stringify(getMaterialColors({ scheme: colorScheme }))
  } catch {
    // The Host itself owns error reporting if native palette resolution is unavailable. A
    // foreground refresh must never turn a recoverable resume into an uncaught JS exception.
    return null
  }
}

function readMaterialPaletteSignatures() {
  return {
    dark: materialPaletteSignature('dark'),
    light: materialPaletteSignature('light'),
  } satisfies PaletteSignatures
}

function materialPaletteChanged(previous: PaletteSignatures, next: PaletteSignatures) {
  return (
    (previous.dark !== null && next.dark !== null && previous.dark !== next.dark) ||
    (previous.light !== null && next.light !== null && previous.light !== next.light)
  )
}

function subscribeToMaterialPalette(listener: () => void) {
  paletteListeners.add(listener)

  if (paletteListeners.size === 1) {
    paletteSignatures = readMaterialPaletteSignatures()
    appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return
      }

      const nextSignatures = readMaterialPaletteSignatures()

      const changed =
        paletteSignatures !== null && materialPaletteChanged(paletteSignatures, nextSignatures)

      paletteSignatures = nextSignatures

      if (changed) {
        paletteRevision += 1

        for (const paletteListener of paletteListeners) {
          paletteListener()
        }
      }
    })
  }

  return () => {
    paletteListeners.delete(listener)

    if (paletteListeners.size === 0) {
      appStateSubscription?.remove()
      appStateSubscription = null
      paletteSignatures = null
    }
  }
}

function getMaterialPaletteRevision() {
  return paletteRevision
}

/**
 * Keeps the native Compose theme and Expo UI's React palette on the same resolved appearance.
 *
 * Expo UI resolves its JS palette from React Native's color-scheme subscription, but an omitted
 * native `colorScheme` prop leaves a retained Compose Host to observe Android configuration on its
 * own. A Host behind a native-stack screen can miss a prop-only update while detached, producing
 * mixed light and dark surfaces when predictive back reveals it. The resolved scheme is part of
 * the native Host key so every retained Compose tree is recreated in the new appearance before it
 * becomes visible.
 *
 * Expo UI memoizes its JS Material palette by appearance and seed color, so a wallpaper change
 * alone does not invalidate `useMaterialColors()`. Compare the native palette when Android returns
 * to the foreground and remount only when those colors actually changed.
 */
export function Host({ colorScheme, ...props }: AndroidHostProps) {
  const systemColorScheme = useAppColorScheme()

  const materialPaletteRevision = useSyncExternalStore(
    subscribeToMaterialPalette,
    getMaterialPaletteRevision,
    getMaterialPaletteRevision,
  )

  const resolvedColorScheme =
    colorScheme === 'dark' || colorScheme === 'light'
      ? colorScheme
      : systemColorScheme === 'dark'
        ? 'dark'
        : 'light'

  return (
    <ExpoHost
      {...props}
      key={`${resolvedColorScheme}:${materialPaletteRevision}`}
      colorScheme={resolvedColorScheme}
    />
  )
}
