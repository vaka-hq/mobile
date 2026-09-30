import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createRequestCache } from './request-cache'

const store = new Map<string, { value: string; expiresAt: number }>()

const cachedRequest = createRequestCache({
  get: async (key) => {
    const row = store.get(key)

    return row && row.expiresAt > Date.now() ? row.value : null
  },
  getStale: async (key) => store.get(key)?.value ?? null,
  set: async (key, value, expiresAt) => {
    store.set(key, { value, expiresAt })
  },
  prune: async () => {},
})

const schema = z.object({ title: z.string() })

describe('request cache', () => {
  beforeEach(() => {
    store.clear()
    vi.useRealTimers()
  })

  it('answers repeats from the cache until the lifetime ends', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => ({ title: 'The Martian' }))

    await cachedRequest('key', 60_000, schema, load)
    await cachedRequest('key', 60_000, schema, load)
    expect(load).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_001)
    await cachedRequest('key', 60_000, schema, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads again when the cached shape no longer validates', async () => {
    store.set('key', { value: JSON.stringify({ name: 'old shape' }), expiresAt: Date.now() + 1000 })

    await expect(
      cachedRequest('key', 1000, schema, async () => ({ title: 'New' })),
    ).resolves.toEqual({ title: 'New' })
  })

  it('never caches failures and can be bypassed for a refresh', async () => {
    await expect(
      cachedRequest('key', 1000, schema, async () => {
        throw new Error('offline')
      }),
    ).rejects.toThrow('offline')
    expect(store.has('key')).toBe(false)

    await cachedRequest('key', 1000, schema, async () => ({ title: 'First' }))

    await expect(
      cachedRequest('key', 1000, schema, async () => ({ title: 'Fresh' }), { fresh: true }),
    ).resolves.toEqual({ title: 'Fresh' })
  })

  it('falls back to an expired answer when loading fails, unless a fresh one is asked for', async () => {
    store.set('key', { value: JSON.stringify({ title: 'Kept' }), expiresAt: Date.now() - 1000 })

    const offline = async () => {
      throw new Error('offline')
    }

    await expect(cachedRequest('key', 1000, schema, offline)).resolves.toEqual({ title: 'Kept' })
    await expect(cachedRequest('key', 1000, schema, offline, { fresh: true })).rejects.toThrow(
      'offline',
    )
  })

  it('returns what it loaded even when keeping it fails', async () => {
    const failing = createRequestCache({
      get: async () => null,
      set: async () => {
        throw new Error('disk full')
      },
      prune: async () => {
        throw new Error('busy')
      },
    })

    await expect(failing('key', 1000, schema, async () => ({ title: 'Loaded' }))).resolves.toEqual({
      title: 'Loaded',
    })
  })

  it('trims the store on the first answer kept and every so many after', async () => {
    const prune = vi.fn(async () => {})

    const trimmed = createRequestCache({
      get: async () => null,
      set: async () => {},
      prune,
    })

    for (let index = 0; index < 51; index += 1) {
      await trimmed(`key-${index}`, 1000, schema, async () => ({ title: 'Book' }))
    }

    // The 1st, 26th and 51st answers.
    expect(prune).toHaveBeenCalledTimes(3)
  })
})
