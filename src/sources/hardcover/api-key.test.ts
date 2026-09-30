import { describe, expect, it } from 'vitest'
import { normalizeApiKey } from './api-key'

describe('Hardcover API keys', () => {
  it('accepts keys pasted with Hardcover’s Bearer prefix', () => {
    expect(normalizeApiKey('  Bearer abc.def.ghi \n')).toBe('abc.def.ghi')
    expect(normalizeApiKey('bearer   xyz')).toBe('xyz')
    expect(normalizeApiKey('hc_pat_123')).toBe('hc_pat_123')
  })
})
