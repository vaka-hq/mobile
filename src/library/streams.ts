import { requireTorBoxKey } from '@/settings/torbox-key'
import { requestDownloadUrl } from '@/sources/torbox/client'

/**
 * TorBox CDN links are signed and short-lived without a documented lifetime. Links are reused
 * for at most this long, and any playback failure requests a fresh one immediately.
 */
export const streamUrlLifetimeMs = 60 * 60 * 1000

export type StreamUrl = {
  url: string
  fetchedAt: number
}

/**
 * Links embed the TorBox API key as a query parameter, so they are kept in memory only; a new
 * app process simply asks TorBox again.
 */
const links = new Map<string, StreamUrl>()

const pending = new Map<string, Promise<StreamUrl>>()

async function request(key: string, torrentId: number, fileId: number) {
  const link = {
    url: await requestDownloadUrl(requireTorBoxKey(), torrentId, fileId),
    fetchedAt: Date.now(),
  }

  links.set(key, link)

  return link
}

/** A playable URL for one file, from the cache while fresh unless `force` is set. */
export async function streamUrl(
  torrentId: number,
  fileId: number,
  force = false,
): Promise<StreamUrl> {
  const key = `${torrentId}:${fileId}`
  const cached = links.get(key)

  if (!force && cached && !isStreamUrlStale(cached.fetchedAt)) {
    return cached
  }

  const inFlight = pending.get(key)

  if (inFlight) {
    return inFlight
  }

  const next = request(key, torrentId, fileId).finally(() => pending.delete(key))

  pending.set(key, next)

  return next
}

export function isStreamUrlStale(fetchedAt: number) {
  return Date.now() - fetchedAt >= streamUrlLifetimeMs
}

/** Forgets every link, for example after the TorBox key changes. */
export function forgetStreamUrls() {
  links.clear()
}
