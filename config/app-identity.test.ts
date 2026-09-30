import { describe, expect, it } from 'vitest'
import { appIdentity } from './app-identity'

describe('build identities', () => {
  it('keeps development, preview and production installs and links separate', () => {
    const identities = ['development', 'preview', 'production'].map((variant) =>
      appIdentity(variant),
    )

    expect(new Set(identities.map((identity) => identity.androidPackage)).size).toBe(3)
    expect(new Set(identities.map((identity) => identity.scheme)).size).toBe(3)
    expect(appIdentity('production')).toMatchObject({
      androidPackage: 'app.vaka.android',
      name: 'Vaka',
      scheme: 'vaka',
    })
  })

  it('defaults to development and rejects unknown variants', () => {
    expect(appIdentity(undefined).variant).toBe('development')
    expect(() => appIdentity('staging')).toThrow('Unknown APP_VARIANT: staging')
  })
})
