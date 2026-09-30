import { requireOptionalNativeModule } from 'expo'

/** An authenticated HTTP proxy. */
export type ProxyServer = {
  host: string
  port: number
  username: string
  password: string
}

export type ProxiedTextResponse = {
  status: number
  body: string
}

type ProxiedHttpModule = {
  /**
   * Reads `url` as text through `server`. Rejects with `ERR_PROXY_AUTH` when the proxy refuses the
   * credentials, `ERR_CANCELLED` after `cancel(id)`, and `ERR_NETWORK` otherwise.
   */
  fetchText(
    id: string,
    url: string,
    headers: Record<string, string>,
    server: ProxyServer,
  ): Promise<ProxiedTextResponse>
  cancel(id: string): void
}

/** Null where the native module is not linked, such as in tests; callers then do without. */
export const ProxiedHttp = requireOptionalNativeModule<ProxiedHttpModule>('ProxiedHttp')
