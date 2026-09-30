import { QueryClientProvider } from '@tanstack/react-query'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AbbSilenceAlert } from '@/components/abb-silence-alert'
import { AccountAlert } from '@/components/account-alert'
import AppError from '@/components/app-error'
import { PlacePrompt } from '@/components/place-prompt'
import { PlayerLayer } from '@/components/player-layer'
import { SystemBack } from '@/components/system-back'
import { UpdateAlert } from '@/components/update-alert'
import { LocalizationProvider } from '@/i18n'
import { useAppColorScheme } from '@/lib/app-color-scheme'
import { FeedbackProvider } from '@/lib/feedback'
import { queryClient } from '@/lib/query-client'
import { rootBackgroundColor } from '@/lib/root-background'
import { checkForUpdatesDaily } from '@/library/app-updates'
import { resumeOfflineDownloads } from '@/library/offline'
import { startPlayer } from '@/player/controller'

export const unstable_settings = { initialRouteName: '(tabs)' }

function AppProviders() {
  const colorScheme = useAppColorScheme()
  const baseTheme = colorScheme === 'dark' ? DarkTheme : DefaultTheme
  const background = rootBackgroundColor(colorScheme === 'dark')

  const theme = useMemo(
    () => ({ ...baseTheme, colors: { ...baseTheme.colors, background, card: background } }),
    [baseTheme, background],
  )

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(background)
  }, [background])

  useEffect(() => {
    // Starting fails only when audio cannot be set up; the app still opens, without the last book.
    startPlayer().catch(() => undefined)
    resumeOfflineDownloads()
    checkForUpdatesDaily()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <StatusBar animated />
          <FeedbackProvider>
            {/* The player floats above every route, so it can grow over the tab bar. */}
            <View style={{ flex: 1 }}>
              <Stack
                screenOptions={{
                  animation: 'fade',
                  contentStyle: { backgroundColor: background },
                  headerShown: false,
                }}
              >
                <Stack.Screen name='(tabs)' />
              </Stack>
              <PlayerLayer />
              <AccountAlert />
              <AbbSilenceAlert />
              <PlacePrompt />
              <UpdateAlert />
              <SystemBack />
            </View>
          </FeedbackProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}

export default function RootLayout() {
  return (
    <LocalizationProvider>
      <AppProviders />
    </LocalizationProvider>
  )
}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <LocalizationProvider>
      <AppError message={error.message} onRetry={retry} />
    </LocalizationProvider>
  )
}
