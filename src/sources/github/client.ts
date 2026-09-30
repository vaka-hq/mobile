import { z } from 'zod'
import { HttpError, request } from '@/lib/http'

/** Where the app's releases are published. */
export const releasesRepository = 'vaka-hq/mobile'

const assetSchema = z.object({
  name: z.string(),
  size: z.number(),
  browser_download_url: z.string(),
  /** `sha256:` and the file's checksum in hex, as GitHub records it for every upload. */
  digest: z.string().nullable().catch(null),
})

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  assets: z.array(assetSchema),
})

export type ReleaseAsset = {
  name: string
  size: number
  url: string
  /** The SHA-256 checksum in lowercase hex, or null where GitHub gives none. */
  sha256: string | null
}

export type Release = {
  tag: string
  /** The release's page, with what changed. */
  pageUrl: string
  prerelease: boolean
  publishedAt: number
  assets: ReleaseAsset[]
}

/** What each release says about the build it holds, in its `update.json`. */
const manifestSchema = z.object({
  versionName: z.string(),
  versionCode: z.number().int().positive(),
  channel: z.enum(['stable', 'nightly']),
})

export type UpdateManifest = z.infer<typeof manifestSchema>

async function readJson(url: string, headers: Record<string, string>, signal?: AbortSignal) {
  const { status, body } = await request(url, { headers, signal }, async (response) => ({
    status: response.status,
    body: await response.json().catch(() => null),
  }))

  if (status < 200 || status >= 300) {
    throw new HttpError(`GitHub answered ${status}`, status)
  }

  return body
}

/** The newest published releases, newest first; drafts are left out. */
export async function listReleases(signal?: AbortSignal): Promise<Release[]> {
  const body = await readJson(
    `https://api.github.com/repos/${releasesRepository}/releases?per_page=20`,
    { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal,
  )

  const releases = z.array(releaseSchema).parse(body)

  return releases
    .flatMap((release) =>
      release.draft || release.published_at === null
        ? []
        : [
            {
              tag: release.tag_name,
              pageUrl: release.html_url,
              prerelease: release.prerelease,
              publishedAt: Date.parse(release.published_at),
              assets: release.assets.map((asset) => ({
                name: asset.name,
                size: asset.size,
                url: asset.browser_download_url,
                sha256: asset.digest?.startsWith('sha256:')
                  ? asset.digest.slice('sha256:'.length).toLowerCase()
                  : null,
              })),
            },
          ],
    )
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

/** Reads a release's `update.json`. */
export async function readUpdateManifest(url: string, signal?: AbortSignal) {
  return manifestSchema.parse(await readJson(url, { Accept: 'application/json' }, signal))
}
