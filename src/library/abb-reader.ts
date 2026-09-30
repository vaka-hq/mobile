import { useSyncExternalStore } from 'react'
import {
  HttpError,
  NetworkError,
  readText,
  request,
  type TextReader,
  TimeoutError,
} from '@/lib/http'
import { proxiedReader } from '@/lib/proxied-http'
import { abbProxyServer, getAbbProxy } from '@/settings/abb-proxy'
import { getPreferences, setPreference } from '@/settings/preferences'

/**
 * AudioBookBay gave no answer to a direct request while the phone is online. It blocks addresses
 * that ask too often, for up to a few days; a proxy gets around that.
 */
export class AbbSilentError extends HttpError {
  constructor() {
    super('AudioBookBay did not answer; it may be blocking this address', null)
    this.name = 'AbbSilentError'
  }
}

/**
 * What Android itself asks to tell whether the phone is online: an empty page, status 204, from
 * anywhere with a working connection.
 */
const connectivityCheckUrl = 'https://connectivitycheck.gstatic.com/generate_204'

async function phoneOnline() {
  try {
    const status = await request(
      connectivityCheckUrl,
      { method: 'HEAD' },
      (response) => Promise.resolve(response.status),
      5000,
    )

    return status === 204
  } catch {
    return false
  }
}

let silent = false

const listeners = new Set<() => void>()

function setSilent(next: boolean) {
  if (silent === next) {
    return
  }

  silent = next

  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** Whether AudioBookBay has stopped answering direct requests, until it answers one again. */
export function useAbbSilent() {
  return useSyncExternalStore(subscribe, () => silent)
}

/**
 * Reads AudioBookBay directly. A request left without any answer while other sites answer means
 * AudioBookBay is likely blocking the phone's address, and fails as `AbbSilentError`; an answer
 * clears that again.
 */
const directReader: TextReader = async (url, headers, signal) => {
  try {
    const response = await readText(url, headers, signal)

    setSilent(false)

    if (getPreferences().abbSilenceNoticed) {
      void setPreference('abbSilenceNoticed', false)
    }

    return response
  } catch (error) {
    const unanswered = error instanceof TimeoutError || error instanceof NetworkError

    if (unanswered && !signal?.aborted && (await phoneOnline())) {
      setSilent(true)
      throw new AbbSilentError()
    }

    throw error
  }
}

/** AudioBookBay pages go through the listener's proxy when one is saved, and directly otherwise. */
export function abbReader(): TextReader {
  const proxy = getAbbProxy()

  return proxy ? proxiedReader(abbProxyServer(proxy)) : directReader
}
