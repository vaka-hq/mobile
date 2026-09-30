import { useSyncExternalStore } from 'react'
import { createSecureValue } from './secure-value'

/**
 * The Anna's Archive member key; it signs in and authorizes fast downloads, so it lives only in
 * the Android keystore.
 */
export const annasKey = createSecureValue('annas.secretKey')

export function useAnnasKey() {
  return useSyncExternalStore(annasKey.subscribe, annasKey.get)
}
