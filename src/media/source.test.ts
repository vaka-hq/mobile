import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpSource } from './source'

function partial(bytes: number[], total: number) {
  return new Response(new Uint8Array(bytes), {
    status: 206,
    headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${total}` },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamed byte ranges', () => {
  it('asks only for the bytes of an exact read', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => partial([1, 2, 3], 1000))

    vi.stubGlobal('fetch', fetch)

    const bytes = await httpSource('https://stream.test/book.m4b').readExact(500, 3)

    expect([...bytes]).toEqual([1, 2, 3])
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Range: 'bytes=500-502' } })
  })

  it('waits out a 429 for as long as the stream asks, then asks again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { 'Retry-After': '0.01' } }),
      )
      .mockResolvedValueOnce(partial([7], 1000))

    vi.stubGlobal('fetch', fetch)

    const bytes = await httpSource('https://stream.test/book.m4b').readExact(10, 1)

    expect([...bytes]).toEqual([7])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not ask a stream that refuses connections again', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network request failed'))

    vi.stubGlobal('fetch', fetch)

    await expect(httpSource('https://stream.test/book.m4b').readExact(0, 1)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
