import type { Release, ReleaseAsset } from '@/sources/github/client'

/** Which releases the app updates to: tested ones only, or every nightly build as well. */
export type UpdateChannel = 'stable' | 'nightly'

/**
 * The release a channel follows, from releases newest first: Stable takes the newest full
 * release; Nightly the newest of any, so it is never behind Stable.
 */
export function releaseFor(releases: Release[], channel: UpdateChannel) {
  return releases.find((release) => channel === 'nightly' || !release.prerelease) ?? null
}

/**
 * The APK built for the phone, trying its CPU architectures in the order it prefers them. Each
 * release holds one per architecture, named for it, such as `vaka-1.1.0-arm64-v8a.apk`.
 */
export function apkFor(release: Release, abis: string[]): ReleaseAsset | null {
  for (const abi of abis) {
    const apk = release.assets.find((asset) => asset.name.endsWith(`-${abi}.apk`))

    if (apk) {
      return apk
    }
  }

  return null
}

/** The release's `update.json`, which says which version it holds. */
export function manifestOf(release: Release) {
  return release.assets.find((asset) => asset.name === 'update.json') ?? null
}
