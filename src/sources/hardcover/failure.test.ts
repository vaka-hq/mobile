import { describe, expect, it } from 'vitest'
import { hardcoverFailure } from './failure'

function reasonOf(status: number, body: string) {
  return hardcoverFailure(status, body).reason
}

describe('Hardcover failures', () => {
  it('takes a 401 for a rejected or expired key', () => {
    // As Hardcover answers a key it does not know.
    expect(
      reasonOf(401, '{"error":"invalid_token","error_description":"Invalid or expired token"}'),
    ).toBe('rejectedKey')
  })

  it('takes a missing permission for one, however Hardcover words it', () => {
    expect(
      reasonOf(
        403,
        '{"error":"insufficient_scope","scope":"write:library","error_description":"x"}',
      ),
    ).toBe('missingScope')
    expect(reasonOf(403, '{"error":"Operation not permitted for this token"}')).toBe('missingScope')
    expect(reasonOf(403, 'Missing scope read:library')).toBe('missingScope')
  })

  it('takes the rate limit and a used-up daily quota for the limit', () => {
    expect(reasonOf(429, '{"error":"Too Many Requests"}')).toBe('rateLimited')
    expect(reasonOf(403, '{"error":"Your daily quota has been reached"}')).toBe('rateLimited')
  })

  it('leaves other refusals as they are', () => {
    expect(reasonOf(403, '{"errors":["request_exceeds_capacity"],"message":"x"}')).toBe('other')
    expect(reasonOf(500, '{"error":"An unknown error occurred"}')).toBe('other')
  })
})
