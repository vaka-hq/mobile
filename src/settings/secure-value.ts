import * as SecureStore from 'expo-secure-store'

type Listener = () => void

/**
 * The stored secret, or null when there is none or it can no longer be decrypted, such as after
 * the phone's keystore was reset; that copy is deleted so the listener can enter it again, and
 * the app starts rather than failing on every launch.
 */
function read(key: string) {
  try {
    return SecureStore.getItem(key)
  } catch {
    void SecureStore.deleteItemAsync(key).catch(() => undefined)

    return null
  }
}

/**
 * A secret kept in the Android keystore with a synchronous, subscribable snapshot so screens can
 * render connection state without waiting on storage.
 */
export function createSecureValue(key: string) {
  let value = read(key)
  const listeners = new Set<Listener>()

  function publish(next: string | null) {
    value = next

    for (const listener of listeners) {
      listener()
    }
  }

  return {
    get: () => value,
    set: async (next: string | null) => {
      if (next === null) {
        await SecureStore.deleteItemAsync(key)
      } else {
        await SecureStore.setItemAsync(key, next)
      }

      publish(next)
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}
