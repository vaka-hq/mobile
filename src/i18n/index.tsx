import './polyfills'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { getLocales, useLocales } from 'expo-localization'
import { type ReactNode, useEffect } from 'react'
import { messages as englishMessages } from '@/locales/en/messages'
import { messages as swedishMessages } from '@/locales/sv/messages'
import { resolveLocale, scheduleStableLocaleActivation } from './locales'

i18n.load('en', englishMessages)

i18n.load('sv', swedishMessages)

i18n.activate(resolveLocale(getLocales()[0]?.languageCode))

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const deviceLocales = useLocales()
  const locale = resolveLocale(deviceLocales[0]?.languageCode)

  useEffect(() => {
    return scheduleStableLocaleActivation({
      activate: (stableLocale) => i18n.activate(stableLocale),
      candidate: locale,
      current: i18n.locale,
      readDeviceLocale: () => resolveLocale(getLocales()[0]?.languageCode),
    })
  }, [locale])

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}

export { i18n }
