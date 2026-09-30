import { useQuery } from '@tanstack/react-query'
import { ProxyAuthError, proxiedReader } from '@/lib/proxied-http'
import { queryClient } from '@/lib/query-client'
import { forgetStreamUrls } from '@/library/streams'
import { AnnasKeyError, verifyAnnasKey } from '@/sources/annas-archive/client'
import { normalizeApiKey } from '@/sources/hardcover/api-key'
import { fetchHardcoverAccount, HardcoverError, verifyApiKey } from '@/sources/hardcover/client'
import { checkExitAddress } from '@/sources/ip-check/client'
import { fetchAccount, isAuthenticationError } from '@/sources/torbox/client'
import { type AbbProxy, abbProxyServer, useAbbProxy } from './abb-proxy'
import { annasKey, useAnnasKey } from './annas-key'
import { hardcoverKey, useHardcoverKey } from './hardcover-key'
import { getPreferences, usePreferences } from './preferences'
import { torBoxKey, useTorBoxKey } from './torbox-key'

/**
 * Checks of the listener's accounts and proxy, shared by Settings and the check at start, so each
 * runs once and both show the same answer.
 */
export const accountCheckKeys = {
  torBox: (apiKey: string | null) => ['torbox-account', apiKey] as const,
  hardcover: (apiKey: string | null) => ['hardcover-key', apiKey] as const,
  annas: (key: string | null, baseUrl: string) => ['annas-key', key, baseUrl] as const,
  proxy: (proxy: Pick<AbbProxy, 'host' | 'port' | 'username'> | null) =>
    ['abb-proxy-check', proxy?.host, proxy?.port, proxy?.username] as const,
}

/**
 * Confirms a request gets through `proxy`. The exit address itself is not shown: a rotating proxy
 * moves every request to another address.
 */
export async function checkProxy(proxy: AbbProxy, signal?: AbortSignal) {
  await checkExitAddress(proxiedReader(abbProxyServer(proxy)), signal)

  return true
}

export function useTorBoxAccount() {
  const apiKey = useTorBoxKey()

  return useQuery({
    queryKey: accountCheckKeys.torBox(apiKey),
    queryFn: ({ signal }) => fetchAccount(apiKey ?? '', signal),
    enabled: Boolean(apiKey),
    retry: false,
  })
}

export function useHardcoverAccount() {
  const apiKey = useHardcoverKey()

  return useQuery({
    queryKey: accountCheckKeys.hardcover(apiKey),
    queryFn: async ({ signal }) => {
      await verifyApiKey(apiKey ?? '', signal)

      return fetchHardcoverAccount(apiKey ?? '', signal)
    },
    enabled: Boolean(apiKey),
    retry: false,
  })
}

export function useProxyCheck() {
  const proxy = useAbbProxy()

  return useQuery({
    queryKey: accountCheckKeys.proxy(proxy),
    queryFn: ({ signal }) => (proxy ? checkProxy(proxy, signal) : null),
    enabled: Boolean(proxy),
    retry: false,
  })
}

export type AccountProblem =
  | 'torBoxKey'
  | 'hardcoverKey'
  | 'annasKey'
  | 'proxySignIn'
  | 'proxyUnreachable'

/**
 * What is wrong with the saved accounts, once every check has answered. Only failures that are
 * certain count: a rejected key or sign-in, or a proxy that fails while the services answer. A
 * phone that is simply offline has no problems to report.
 */
export function useAccountProblems(): AccountProblem[] | null {
  const torBox = useTorBoxAccount()
  const hardcover = useHardcoverAccount()
  const proxy = useProxyCheck()
  const annas = useAnnasAccount()
  const checks = [torBox, hardcover, proxy, annas]

  if (checks.some((check) => check.fetchStatus === 'fetching')) {
    return null
  }

  const online = torBox.isSuccess || hardcover.isSuccess
  const problems: AccountProblem[] = []

  if (torBox.error && isAuthenticationError(torBox.error)) {
    problems.push('torBoxKey')
  }

  if (
    hardcover.error instanceof HardcoverError &&
    (hardcover.error.reason === 'rejectedKey' || hardcover.error.reason === 'missingScope')
  ) {
    problems.push('hardcoverKey')
  }

  if (annas.error instanceof AnnasKeyError) {
    problems.push('annasKey')
  }

  if (proxy.error instanceof ProxyAuthError) {
    problems.push('proxySignIn')
  } else if (proxy.error && online) {
    problems.push('proxyUnreachable')
  }

  return problems
}

/** Checks a TorBox key with TorBox and keeps it once accepted; resolves with the account. */
export async function connectTorBox(key: string) {
  const details = await fetchAccount(key)

  await torBoxKey.set(key)
  forgetStreamUrls()
  queryClient.setQueryData(accountCheckKeys.torBox(key), details)
  void queryClient.invalidateQueries({ queryKey: ['torbox'] })

  return details
}

/** Checks a Hardcover key with Hardcover and keeps it once accepted; resolves with the account. */
export async function connectHardcover(value: string) {
  const key = normalizeApiKey(value)

  await verifyApiKey(key)

  const account = await fetchHardcoverAccount(key)

  await hardcoverKey.set(key)
  queryClient.setQueryData(accountCheckKeys.hardcover(key), account)
  // Books that could not be matched without a key are matched on their next visit.
  void queryClient.invalidateQueries({ queryKey: ['hardcover'] })

  return account
}

/** Whether Anna's Archive accepts the saved member key, on the chosen mirror. */
export function useAnnasAccount() {
  const key = useAnnasKey()
  const { annasBaseUrl } = usePreferences()

  return useQuery({
    queryKey: accountCheckKeys.annas(key, annasBaseUrl),
    queryFn: async ({ signal }) => {
      await verifyAnnasKey(annasBaseUrl, key ?? '', signal)

      return true
    },
    enabled: Boolean(key),
    retry: false,
  })
}

/** Checks an Anna's Archive member key and keeps it once accepted. */
export async function connectAnnas(value: string) {
  const key = value.trim()
  const { annasBaseUrl } = getPreferences()

  await verifyAnnasKey(annasBaseUrl, key)
  await annasKey.set(key)
  queryClient.setQueryData(accountCheckKeys.annas(key, annasBaseUrl), true)
}
