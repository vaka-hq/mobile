import { describe, expect, it } from 'vitest'
import type { Release } from '@/sources/github/client'
import { apkFor, manifestOf, releaseFor } from './update-release'

function release(tag: string, prerelease: boolean, assets: string[] = []): Release {
  return {
    tag,
    pageUrl: `https://github.com/vaka-hq/mobile/releases/tag/${tag}`,
    prerelease,
    publishedAt: 0,
    assets: assets.map((name) => ({
      name,
      size: 1,
      url: `https://example.com/${name}`,
      sha256: 'ab',
    })),
  }
}

describe('releaseFor', () => {
  const releases = [
    release('nightly-20261002', true),
    release('v1.1.0', false),
    release('nightly-20261001', true),
  ]

  it('gives Stable the newest full release', () => {
    expect(releaseFor(releases, 'stable')?.tag).toBe('v1.1.0')
  })

  it('gives Nightly the newest release of any kind', () => {
    expect(releaseFor(releases, 'nightly')?.tag).toBe('nightly-20261002')
  })

  it('has nothing for Stable before the first stable release', () => {
    expect(releaseFor([release('nightly-20261001', true)], 'stable')).toBeNull()
  })
})

describe('apkFor', () => {
  const build = release('v1.1.0', false, [
    'update.json',
    'vaka-1.1.0-armeabi-v7a.apk',
    'vaka-1.1.0-arm64-v8a.apk',
    'vaka-1.1.0-x86_64.apk',
  ])

  it('takes the architecture the phone prefers', () => {
    expect(apkFor(build, ['arm64-v8a', 'armeabi-v7a'])?.name).toBe('vaka-1.1.0-arm64-v8a.apk')
  })

  it('falls back to the next architecture the phone runs', () => {
    expect(apkFor(build, ['x86', 'x86_64'])?.name).toBe('vaka-1.1.0-x86_64.apk')
  })

  it('does not mistake one architecture for another that ends the same', () => {
    expect(apkFor(release('v1', false, ['vaka-1-x86_64.apk']), ['x86'])).toBeNull()
  })

  it('finds the manifest', () => {
    expect(manifestOf(build)?.name).toBe('update.json')
  })
})
