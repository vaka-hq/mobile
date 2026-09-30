import { z } from 'zod'
import { ProxiedHttp, type ProxyServer } from '../../modules/proxied-http'
import { HttpError, type TextReader, withDeadline } from './http'

/** The proxy refused the username and password. */
export class ProxyAuthError extends HttpError {
  constructor() {
    super('The proxy did not accept the username and password', 407)
    this.name = 'ProxyAuthError'
  }
}

/** The error code a native module rejects with. */
const nativeFailure = z.object({ code: z.string() })

let lastRequestId = 0

/** Reads pages through `server`, with the same deadline and cancellation as `fetch` requests. */
export function proxiedReader(server: ProxyServer): TextReader {
  return (url, headers, signal) =>
    withDeadline(signal, async (deadline) => {
      if (!ProxiedHttp) {
        throw new HttpError('The proxy module is not linked into this build', null)
      }

      const native = ProxiedHttp
      const id = String(++lastRequestId)
      const cancel = () => native.cancel(id)

      deadline.addEventListener('abort', cancel)

      try {
        const response = await native.fetchText(id, url, headers, server)

        // An HTTP page can surface the refusal as a status instead of a failed tunnel.
        if (response.status === 407) {
          throw new ProxyAuthError()
        }

        return response
      } catch (cause) {
        if (cause instanceof HttpError || deadline.aborted) {
          throw cause
        }

        const failure = nativeFailure.safeParse(cause)

        if (failure.success && failure.data.code === 'ERR_PROXY_AUTH') {
          throw new ProxyAuthError()
        }

        throw new HttpError('Could not connect through the proxy', null)
      } finally {
        deadline.removeEventListener('abort', cancel)
      }
    })
}
