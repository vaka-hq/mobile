import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { ProxyServer } from '../../modules/proxied-http'
import { createSecureValue } from './secure-value'

const abbProxySchema = z.object({
  host: z.string().min(1),
  // A proxy saved before its port could be set always used 10000, and still does until changed.
  port: z.number().int().min(1).max(65_535).default(10_000),
  username: z.string().min(1),
  password: z.string().min(1),
})

/** The proxy AudioBookBay pages go through; the password makes it a secret, kept in the keystore. */
export type AbbProxy = z.infer<typeof abbProxySchema>

const stored = createSecureValue('audiobookbay.proxy')

/** The stored text and what it parsed to, so repeated reads return the same object. */
type ParsedProxy = {
  raw: string | null
  proxy: AbbProxy | null
}

let parsed: ParsedProxy = { raw: null, proxy: null }

/** The saved proxy, re-validated when read; the same object is returned until it changes. */
export function getAbbProxy() {
  const raw = stored.get()

  if (raw !== parsed.raw) {
    let proxy: AbbProxy | null = null

    try {
      const result = abbProxySchema.safeParse(raw ? JSON.parse(raw) : null)

      proxy = result.success ? result.data : null
    } catch {
      // Unreadable JSON counts as no proxy; requests go directly.
    }

    parsed = { raw, proxy }
  }

  return parsed.proxy
}

export function useAbbProxy() {
  return useSyncExternalStore(stored.subscribe, getAbbProxy)
}

export async function setAbbProxy(proxy: AbbProxy | null) {
  await stored.set(proxy ? JSON.stringify(proxy) : null)
}

export function abbProxyServer(proxy: AbbProxy): ProxyServer {
  return proxy
}
