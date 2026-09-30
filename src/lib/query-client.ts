import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query'
import { AppState } from 'react-native'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  },
})

focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (state) =>
    setFocused(state === 'active'),
  )

  return () => subscription.remove()
})

onlineManager.setOnline(true)
