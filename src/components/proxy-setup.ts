import { useLingui } from '@lingui/react/macro'
import { ProxyAuthError } from '@/lib/proxied-http'
import { queryClient } from '@/lib/query-client'
import { setAbbProxy } from '@/settings/abb-proxy'
import { accountCheckKeys, checkProxy } from '@/settings/account-checks'
import { parseProxyAddress, parseProxyPort } from '@/settings/proxy-address'

/** What the proxy form asks for. */
export type ProxyFields = Record<'host' | 'port' | 'username' | 'password', string>

/**
 * Setting up the AudioBookBay proxy, as Settings and the welcome screens do: `problem` words why
 * a proxy does not work, and `save` checks the one entered and keeps it only if it answers,
 * resolving with a problem to show, or null once it is saved.
 */
export function useProxySetup() {
  const { t } = useLingui()

  function problem(error: Error) {
    if (error instanceof ProxyAuthError) {
      return t({
        message: 'The proxy did not accept this username and password',
        comment: 'AudioBookBay proxy rejected the sign-in',
      })
    }

    return t({
      message: 'Could not connect through the proxy. Check the address and try again.',
      comment: 'AudioBookBay proxy unreachable or not answering',
    })
  }

  async function save(values: ProxyFields) {
    let address: { host: string; port: number | null }

    try {
      address = parseProxyAddress(values.host)
    } catch {
      return t({ message: 'That is not a valid proxy address', comment: 'Invalid proxy host' })
    }

    // The port field, or one written into the address when the field is left empty.
    const port = values.port ? parseProxyPort(values.port) : address.port

    if (port === null) {
      return t({
        message: 'Enter a port from 1 to 65535',
        comment: 'The proxy port is missing or not a valid number',
      })
    }

    const proxy = { host: address.host, port, username: values.username, password: values.password }

    try {
      // Only a proxy that answers an address check is kept.
      await checkProxy(proxy)
      await setAbbProxy(proxy)
      queryClient.setQueryData(accountCheckKeys.proxy(proxy), true)

      return null
    } catch (error) {
      return problem(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return { problem, save }
}
