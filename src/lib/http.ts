/** A failed request, with the HTTP status when the server answered. */
export class HttpError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** The server took longer than the deadline to answer. */
export class TimeoutError extends HttpError {
  constructor() {
    super('The request timed out', null)
    this.name = 'TimeoutError'
  }
}

/** The connection itself failed, such as with the phone offline. */
export class NetworkError extends HttpError {
  constructor() {
    super('Network error', null)
    this.name = 'NetworkError'
  }
}

const defaultTimeoutMs = 20_000

/**
 * Runs `run` with a signal that aborts at the deadline or when the caller cancels, so a stalled
 * mirror or API never leaves a screen loading forever. A missed deadline becomes an `HttpError`;
 * a cancellation passes through untouched.
 */
export async function withDeadline<T>(
  signal: AbortSignal | null | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = defaultTimeoutMs,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()

  signal?.addEventListener('abort', abort)

  try {
    return await run(controller.signal)
  } catch (cause) {
    if (signal?.aborted) {
      throw cause
    }

    if (controller.signal.aborted) {
      throw new TimeoutError()
    }

    throw cause
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

/**
 * `fetch` within a deadline that also honours the caller's cancellation. `read` consumes the
 * response inside the deadline, since a body can stall long after the headers arrived.
 */
export async function request<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
  timeoutMs = defaultTimeoutMs,
) {
  return withDeadline(
    init.signal,
    async (signal) => {
      try {
        return await read(await fetch(url, { ...init, signal }))
      } catch (cause) {
        // `fetch` rejects with a TypeError when the connection itself fails.
        if (cause instanceof TypeError && !signal.aborted) {
          throw new NetworkError()
        }

        throw cause
      }
    },
    timeoutMs,
  )
}

/** A page's status and body, whichever route the request took. */
export type TextResponse = {
  status: number
  body: string
}

/**
 * Reads a URL as text. `readText` goes straight out with `fetch`; a proxied reader has the same
 * shape, so a source can be routed through a proxy without knowing how.
 */
export type TextReader = (
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
) => Promise<TextResponse>

export const readText: TextReader = (url, headers, signal) =>
  request(url, { headers, signal }, async (response) => ({
    status: response.status,
    body: await response.text(),
  }))
