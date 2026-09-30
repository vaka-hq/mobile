import { getMaterialColors } from '@expo/ui/jetpack-compose'

/** The Material `surface` behind native-stack transitions, so fades never flash white. */
export function rootBackgroundColor(isDark: boolean) {
  return getMaterialColors({ scheme: isDark ? 'dark' : 'light' }).surface
}
