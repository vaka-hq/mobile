import { useSyncExternalStore } from 'react'
import { createSecureValue } from './secure-value'

/** The TorBox API key; it authorizes the account, so it lives only in the Android keystore. */
export const torBoxKey = createSecureValue('torbox.apiKey')

export function useTorBoxKey() {
  return useSyncExternalStore(torBoxKey.subscribe, torBoxKey.get)
}

export class TorBoxKeyMissingError extends Error {
  constructor() {
    super('Add your TorBox API key in Settings to stream audiobooks')
    this.name = 'TorBoxKeyMissingError'
  }
}

export function requireTorBoxKey() {
  const key = torBoxKey.get()

  if (!key) {
    throw new TorBoxKeyMissingError()
  }

  return key
}
