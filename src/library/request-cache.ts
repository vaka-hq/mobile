import type { z } from 'zod'

/**
 * Where answers are kept; SQLite in the app, a map in tests. Expired rows read as missing to
 * `get`; `getStale` still reads them, for when a fresh answer cannot be had.
 */
export type ResponseStore = {
  get: (key: string) => Promise<string | null>
  getStale?: (key: string) => Promise<string | null>
  set: (key: string, value: string, expiresAt: number) => Promise<void>
  prune: () => Promise<void>
}

/** A stored answer read with `schema`; a row cut short or corrupted reads as missing. */
function readStored<T extends z.ZodType>(text: string, schema: T) {
  try {
    return schema.safeParse(JSON.parse(text))
  } catch {
    return null
  }
}

/** How many answers are stored between trims of the store, the first of them trimming too. */
const pruneEvery = 25

/**
 * The answer to a request, from the store while it is younger than `lifetimeMs`, else from
 * `load`, which is then remembered. Cached answers are validated with the same schema as fresh
 * ones, so a changed shape simply loads again. Failures are never cached; when loading fails, such
 * as offline, the last answer kept is used however old it is, unless a fresh one was asked for.
 * Every so many answers stored, the store is trimmed, so it never grows past its bounds for long.
 * Storing and trimming are best-effort: an answer loaded is returned even if keeping it fails.
 */
export function createRequestCache(store: ResponseStore) {
  let stored = 0

  return async function cachedRequest<T extends z.ZodType>(
    key: string,
    lifetimeMs: number,
    schema: T,
    load: () => Promise<z.infer<T>>,
    options: { fresh?: boolean } = {},
  ): Promise<z.infer<T>> {
    if (!options.fresh) {
      const stored = await store.get(key)

      if (stored !== null) {
        const parsed = readStored(stored, schema)

        if (parsed?.success) {
          return parsed.data
        }
      }
    }

    let value: z.infer<T>

    try {
      value = await load()
    } catch (error) {
      const stale = options.fresh ? null : await store.getStale?.(key).catch(() => null)
      const parsed = stale ? readStored(stale, schema) : null

      if (parsed?.success) {
        return parsed.data
      }

      throw error
    }

    if (stored % pruneEvery === 0) {
      await store.prune().catch(() => undefined)
    }

    stored += 1

    await store.set(key, JSON.stringify(value), Date.now() + lifetimeMs).catch(() => undefined)

    return value
  }
}
