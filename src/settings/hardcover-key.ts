import { useSyncExternalStore } from 'react'
import { createSecureValue } from './secure-value'

/** The Hardcover API key; it authorizes the account, so it lives only in the Android keystore. */
export const hardcoverKey = createSecureValue('hardcover.apiKey')

export function useHardcoverKey() {
  return useSyncExternalStore(hardcoverKey.subscribe, hardcoverKey.get)
}
