import { z } from 'zod'
import { HttpError } from '@/lib/http'

/** Why Hardcover refused a request, for messages the listener can act on. */
type HardcoverFailure = 'rejectedKey' | 'missingScope' | 'rateLimited' | 'other'

export class HardcoverError extends HttpError {
  readonly reason: HardcoverFailure

  constructor(message: string, status: number | null, reason: HardcoverFailure = 'other') {
    super(message, status)
    this.name = 'HardcoverError'
    this.reason = reason
  }
}

const failure = z.object({
  error: z.string().nullish(),
  error_description: z.string().nullish(),
  scope: z.string().nullish(),
})

/** The error for a refused request, named for what the listener can do about it. */
export function hardcoverFailure(status: number, body: string) {
  let reason: z.infer<typeof failure> | null = null

  try {
    const parsed = failure.safeParse(JSON.parse(body))

    reason = parsed.success ? parsed.data : null
  } catch {
    // A body that is not JSON, such as a gateway's page, is read as words below.
  }

  // A 403 says why in words: a missing permission, or the day's requests used up.
  const detail = (reason?.error_description ?? reason?.error ?? body).toLowerCase()

  if (status === 401) {
    return new HardcoverError('Hardcover did not accept the API key', status, 'rejectedKey')
  }

  if (
    reason?.error === 'insufficient_scope' ||
    (status === 403 && /scope|insufficient|not permitted for this token/u.test(detail))
  ) {
    return new HardcoverError(
      `The Hardcover API key is missing the ${reason?.scope ?? 'needed'} permission`,
      status,
      'missingScope',
    )
  }

  if (status === 429 || (status === 403 && detail.includes('quota has been reached'))) {
    return new HardcoverError('Hardcover’s rate limit was reached', status, 'rateLimited')
  }

  return new HardcoverError(
    reason?.error_description ?? reason?.error ?? `Hardcover answered ${status}`,
    status,
  )
}
