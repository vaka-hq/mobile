import { z } from 'zod'
import { HttpError, request } from '@/lib/http'

const apiUrl = 'https://api.torbox.app/v1/api'

const envelope = z.object({
  success: z.boolean(),
  error: z.string().nullish(),
  detail: z.string().nullish(),
  data: z.json().optional(),
})

const failure = z.object({
  error: z.string().nullish(),
  detail: z.string().nullish(),
})

const torrentFile = z.object({
  id: z.number(),
  name: z.string(),
  short_name: z.string().nullish(),
  size: z.number(),
  mimetype: z.string().nullish(),
})

const torrent = z.object({
  id: z.number(),
  hash: z.string(),
  name: z.string(),
  size: z.number(),
  download_state: z.string().nullish(),
  download_finished: z.boolean().nullish(),
  download_present: z.boolean().nullish(),
  progress: z.number().nullish(),
  eta: z.number().nullish(),
  files: z.array(torrentFile).nullish(),
})

const cachedTorrent = z.object({
  name: z.string().nullish(),
  size: z.number().nullish(),
  hash: z.string(),
  files: z.array(z.object({ name: z.string(), size: z.number() })).nullish(),
})

export type TorBoxTorrent = z.infer<typeof torrent>

export type TorBoxFile = z.infer<typeof torrentFile>

/** TorBox rejected the request; `code` is its machine-readable error, such as `BAD_TOKEN`. */
export class TorBoxError extends HttpError {
  readonly code: string | null

  constructor(message: string, status: number | null, code: string | null) {
    super(message, status)
    this.name = 'TorBoxError'
    this.code = code
  }
}

async function call<T extends z.ZodType>(
  apiKey: string,
  path: string,
  schema: T,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  timeoutMs?: number,
): Promise<z.infer<T>> {
  const { ok, status, body } = await request(
    `${apiUrl}${path}`,
    {
      ...init,
      headers: {
        ...init.headers,
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    },
    async (response) => ({
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    }),
    timeoutMs,
  )

  const parsed = envelope.safeParse(body)
  const data = parsed.success ? schema.safeParse(parsed.data.data ?? null) : null

  if (!ok || !parsed.success || !parsed.data.success || !data?.success) {
    const reason = failure.safeParse(body)
    const code = reason.success ? (reason.data.error ?? null) : null
    const detail = reason.success ? reason.data.detail : null

    throw new TorBoxError(detail ?? code ?? `TorBox answered ${status}`, status, code)
  }

  return data.data
}

/**
 * TorBox took the torrent but queued it, as the account is downloading all it may at once; it
 * starts by itself once another finishes.
 */
export class TorBoxQueuedError extends Error {
  constructor() {
    super('TorBox queued the download until another finishes')
    this.name = 'TorBoxQueuedError'
  }
}

export function isAuthenticationError(error: Error) {
  return (
    error instanceof TorBoxError &&
    (error.status === 401 ||
      error.status === 403 ||
      error.code === 'BAD_TOKEN' ||
      error.code === 'AUTH_ERROR')
  )
}

export function fetchAccount(apiKey: string, signal?: AbortSignal) {
  return call(
    apiKey,
    '/user/me',
    z.object({ email: z.string().nullish(), plan: z.number().nullish() }),
    { signal },
  )
}

/** The cached copy of a torrent, or null when TorBox would have to download it first. */
async function cachedTorrents(
  apiKey: string,
  hashes: string[],
  listFiles: boolean,
  signal?: AbortSignal,
) {
  // Lists are requested, but an empty result can arrive as an object keyed by hash.
  const cached = await call(
    apiKey,
    `/torrents/checkcached?hash=${hashes.join(',')}&format=list&list_files=${listFiles}`,
    z.union([z.array(cachedTorrent), z.record(z.string(), cachedTorrent)]).nullish(),
    { signal },
  )

  return Array.isArray(cached) ? cached : Object.values(cached ?? {})
}

/** Which of several info hashes TorBox already holds, in one request; lowercased. */
export async function cachedHashes(apiKey: string, hashes: string[], signal?: AbortSignal) {
  if (hashes.length === 0) {
    return new Set<string>()
  }

  const items = await cachedTorrents(apiKey, hashes, false, signal)

  return new Set(items.map((item) => item.hash.toLowerCase()))
}

/** Every torrent in the listener's TorBox, fresh rather than from TorBox's short-lived cache. */
export async function listTorrents(apiKey: string, signal?: AbortSignal) {
  const torrents = await call(
    apiKey,
    '/torrents/mylist?bypass_cache=true&limit=1000',
    z.array(torrent).nullish(),
    { signal },
  )

  return torrents ?? []
}

const swarm = z.object({ seeds: z.number().nullish(), peers: z.number().nullish() })

/**
 * How many seeders and peers are sharing a torrent, without adding it. The quick lookup asks only
 * the trackers in `magnet`; the thorough one also searches the DHT, which finds peers on torrents
 * whose trackers are gone but takes longer. Trackers that do not answer count as zero, so a zero
 * from the quick lookup alone proves little.
 */
export async function torrentSwarm(
  apiKey: string,
  magnet: string,
  thorough: boolean,
  signal?: AbortSignal,
) {
  const form = new FormData()
  const peersOnly = thorough ? 'false' : 'true'
  const timeout = thorough ? '12' : '8'

  form.append('magnet', magnet)
  form.append('peers_only', peersOnly)
  form.append('timeout', timeout)

  const info = await call(
    apiKey,
    `/torrents/torrentinfo?peers_only=${peersOnly}&timeout=${timeout}`,
    swarm,
    { method: 'POST', body: form, signal },
    // TorBox answers the thorough search only after its own timeout, and then some.
    thorough ? 30_000 : undefined,
  )

  return { seeds: info.seeds ?? null, peers: info.peers ?? null }
}

/** Stops a torrent and removes it from the listener's TorBox. */
export async function deleteTorrent(apiKey: string, torrentId: number) {
  await call(apiKey, '/torrents/controltorrent', z.unknown(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' }),
  })
}

export function fetchTorrent(apiKey: string, id: number, signal?: AbortSignal) {
  return call(apiKey, `/torrents/mylist?id=${id}&bypass_cache=true`, torrent, { signal })
}

export async function createTorrent(apiKey: string, magnet: string, name: string) {
  const form = new FormData()

  form.append('magnet', magnet)
  form.append('name', name)
  form.append('allow_zip', 'false')

  const created = await call(
    apiKey,
    '/torrents/createtorrent',
    z.object({
      torrent_id: z.number().nullish(),
      queued_id: z.number().nullish(),
      hash: z.string().nullish(),
    }),
    { method: 'POST', body: form },
  )

  if (created.torrent_id === null || created.torrent_id === undefined) {
    throw created.queued_id === null || created.queued_id === undefined
      ? new TorBoxError('TorBox did not say which torrent it added', null, null)
      : new TorBoxQueuedError()
  }

  return created.torrent_id
}

/** A signed CDN link for one file. TorBox links are temporary, so callers must refresh them. */
export function requestDownloadUrl(apiKey: string, torrentId: number, fileId: number) {
  const query = new URLSearchParams({
    token: apiKey,
    torrent_id: String(torrentId),
    file_id: String(fileId),
    redirect: 'false',
  })

  return call(apiKey, `/torrents/requestdl?${query.toString()}`, z.url())
}
