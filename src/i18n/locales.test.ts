import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveLocale, scheduleStableLocaleActivation } from './locales'

afterEach(() => {
  vi.useRealTimers()
})

describe('locale resolution', () => {
  it('uses Swedish for Swedish language tags', () => {
    expect(resolveLocale('sv-SE')).toBe('sv')
    expect(resolveLocale('sv-FI')).toBe('sv')
  })

  it('uses English for English, missing, and unsupported languages', () => {
    expect(resolveLocale('en-GB')).toBe('en')
    expect(resolveLocale('de-DE')).toBe('en')
    expect(resolveLocale(null)).toBe('en')
  })

  it('does not activate a transient locale reported while Android resumes', () => {
    vi.useFakeTimers()
    const activate = vi.fn()

    scheduleStableLocaleActivation({
      activate,
      candidate: 'en',
      current: 'sv',
      readDeviceLocale: () => 'sv',
      stabilityMs: 250,
    })

    vi.advanceTimersByTime(250)

    expect(activate).not.toHaveBeenCalled()
  })

  it('activates a genuine locale change after it remains stable', () => {
    vi.useFakeTimers()
    const activate = vi.fn()

    scheduleStableLocaleActivation({
      activate,
      candidate: 'en',
      current: 'sv',
      readDeviceLocale: () => 'en',
      stabilityMs: 250,
    })

    vi.advanceTimersByTime(250)

    expect(activate).toHaveBeenCalledExactlyOnceWith('en')
  })
})
