export const locales = ['en', 'sv'] as const

export type Locale = (typeof locales)[number]

export const sourceLocale: Locale = 'en'

export const localeActivationStabilityMs = 250

export function resolveLocale(candidate: string | null | undefined): Locale {
  if (!candidate) {
    return sourceLocale
  }

  const language = candidate.toLowerCase().split('-')[0]

  return language === 'sv' ? 'sv' : sourceLocale
}

export type StableLocaleActivation = {
  activate: (locale: Locale) => void
  candidate: Locale
  current: string
  readDeviceLocale: () => Locale
  stabilityMs?: number
}

/**
 * Android can report the previous locale for a moment while the app resumes. Activate a change
 * only once the device still reports it after a short pause, so the UI never flashes languages.
 */
export function scheduleStableLocaleActivation({
  activate,
  candidate,
  current,
  readDeviceLocale,
  stabilityMs = localeActivationStabilityMs,
}: StableLocaleActivation) {
  if (candidate === current) {
    return () => undefined
  }

  const timeout = setTimeout(() => {
    if (readDeviceLocale() === candidate) {
      activate(candidate)
    }
  }, stabilityMs)

  return () => clearTimeout(timeout)
}
