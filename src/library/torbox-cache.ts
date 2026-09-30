import { z } from 'zod'
import { magnetLink } from '@/sources/audiobookbay/parse'
import type { AbbBook } from '@/sources/audiobookbay/parse'
import { cachedHashes, torrentSwarm } from '@/sources/torbox/client'
import { getCachedResponse, saveCachedResponse } from './repository'

const minute = 60 * 1000

/**
 * TorBox keeps a cached torrent for days, so a yes is trusted for half a day. A torrent it lacks
 * can be cached by anyone at any time, so a no is asked again after an hour.
 */
const cachedLifetimeMs = 12 * 60 * minute

const missingLifetimeMs = 60 * minute

function storeKey(hash: string) {
  return `torbox:cached:${hash}`
}

async function remembered(hash: string) {
  const stored = await getCachedResponse(storeKey(hash))

  if (stored === null) {
    return null
  }

  try {
    const parsed = z.boolean().safeParse(JSON.parse(stored))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Which of `hashes` TorBox has cached. Each answer is remembered per torrent across launches, so
 * reopening a book only asks TorBox about uploads it has not answered for recently.
 */
export async function torBoxCachedHashes(apiKey: string, hashes: string[], signal?: AbortSignal) {
  const cached = new Set<string>()
  const unknown: string[] = []

  for (const hash of new Set(hashes.map((item) => item.toLowerCase()))) {
    const known = await remembered(hash)

    if (known === null) {
      unknown.push(hash)
    } else if (known) {
      cached.add(hash)
    }
  }

  if (unknown.length > 0) {
    const fresh = await cachedHashes(apiKey, unknown, signal)
    const now = Date.now()

    for (const hash of unknown) {
      const isCached = fresh.has(hash)

      await saveCachedResponse(
        storeKey(hash),
        JSON.stringify(isCached),
        now + (isCached ? cachedLifetimeMs : missingLifetimeMs),
      )

      if (isCached) {
        cached.add(hash)
      }
    }
  }

  return cached
}

/**
 * A torrent that has just finished in the listener's TorBox is cached there now, whatever TorBox
 * said about it before the download; a remembered "not cached" would otherwise linger for an hour.
 */
export async function rememberCached(hash: string) {
  await saveCachedResponse(storeKey(hash.toLowerCase()), 'true', Date.now() + cachedLifetimeMs)
}

/**
 * TorBox's torrent list keeps showing a removed torrent for several minutes. Torrents removed from
 * this app are remembered across launches for that long, and ignored in the list meanwhile, so a
 * cancelled download does not seem to carry on.
 */
const removedLifetimeMs = 30 * minute

function removedKey(hash: string) {
  return `torbox:removed:${hash.toLowerCase()}`
}

export async function rememberRemoved(hash: string) {
  await saveCachedResponse(removedKey(hash), 'true', Date.now() + removedLifetimeMs)
}

/** The torrent was added again, so the list is to be believed about it once more. */
export async function forgetRemoved(hash: string) {
  await saveCachedResponse(removedKey(hash), 'false', Date.now())
}

export async function removedRecently(hash: string) {
  return (await getCachedResponse(removedKey(hash))) !== null
}

/** A count with seeders is trusted for half an hour; a zero is asked again after five minutes. */
const swarmLifetimeMs = 30 * minute

const emptySwarmLifetimeMs = 5 * minute

/** A torrent seen with a seeder this recently is not called dead when its trackers go quiet. */
const seedingMemoryMs = 6 * 60 * minute

function swarmKey(hash: string) {
  return `torbox:sharing:${hash.toLowerCase()}`
}

function seedingKey(hash: string) {
  return `torbox:seeded:${hash.toLowerCase()}`
}

const swarmSchema = z.object({
  seeds: z.number(),
  peers: z.number().nullable(),
  dead: z.boolean(),
})

/**
 * Who is sharing a torrent: seeders have all of it, peers parts. `dead` means no seeder was found
 * even after a thorough search, and none has been seen for hours.
 */
export type Swarm = z.infer<typeof swarmSchema>

async function rememberedSwarm(hash: string) {
  const stored = await getCachedResponse(swarmKey(hash))

  if (stored === null) {
    return null
  }

  try {
    const parsed = swarmSchema.safeParse(JSON.parse(stored))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function lookup(apiKey: string, magnet: string, thorough: boolean, signal?: AbortSignal) {
  try {
    const { seeds, peers } = await torrentSwarm(apiKey, magnet, thorough, signal)

    return seeds === null ? null : { seeds, peers }
  } catch {
    return null
  }
}

/**
 * Who is sharing an upload. Trackers that do not answer count as zero, and old uploads often list
 * trackers long gone, so the same torrent can read zero one minute and one seeder the next. A zero
 * from the quick tracker lookup is therefore checked again with a thorough search, and a torrent
 * seen with a seeder in the last hours is not called dead. Null when nothing answered at all.
 */
export async function torrentSwarmOf(
  apiKey: string,
  post: Pick<AbbBook, 'infoHash' | 'title' | 'trackers'>,
  signal?: AbortSignal,
): Promise<Swarm | null> {
  const known = await rememberedSwarm(post.infoHash)

  if (known) {
    return known
  }

  const magnet = magnetLink(post)
  const quick = await lookup(apiKey, magnet, false, signal)
  const thorough = quick && quick.seeds > 0 ? null : await lookup(apiKey, magnet, true, signal)
  const found = thorough && thorough.seeds > 0 ? thorough : (quick ?? thorough)

  if (!found) {
    return null
  }

  if (found.seeds > 0) {
    await saveCachedResponse(seedingKey(post.infoHash), 'true', Date.now() + seedingMemoryMs)
  }

  const seededLately = (await getCachedResponse(seedingKey(post.infoHash))) !== null
  const swarm = { ...found, dead: found.seeds === 0 && !seededLately }

  await saveCachedResponse(
    swarmKey(post.infoHash),
    JSON.stringify(swarm),
    Date.now() + (found.seeds > 0 ? swarmLifetimeMs : emptySwarmLifetimeMs),
  )

  return swarm
}
