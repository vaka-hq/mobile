import { describe, expect, it } from 'vitest'
import { chapterNumber, clock, dataSize, hoursAndMinutes, speedLabel } from './format'

describe('formatting', () => {
  it('formats media clocks', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(245.9)).toBe('4:05')
    expect(clock(3845)).toBe('1:04:05')
    expect(clock(-3)).toBe('0:00')
  })

  it('rounds durations up to whole minutes', () => {
    expect(hoursAndMinutes(20)).toEqual({ hours: 0, minutes: 1 })
    expect(hoursAndMinutes(3 * 3600 + 59 * 60 + 1)).toEqual({ hours: 4, minutes: 0 })
  })

  it('formats speeds without trailing zeros', () => {
    expect(speedLabel(1)).toBe('1×')
    expect(speedLabel(1.25)).toBe('1.25×')
    expect(speedLabel(1.1000001)).toBe('1.1×')
  })
})

describe('chapter numbers', () => {
  it('reads placeholder titles as their number', () => {
    expect(chapterNumber('001')).toBe(1)
    expect(chapterNumber('01')).toBe(1)
    expect(chapterNumber('26')).toBe(26)
    expect(chapterNumber('Chapter 003')).toBe(3)
    expect(chapterNumber('Track 07')).toBe(7)
  })

  it('leaves real titles alone', () => {
    expect(chapterNumber('The Hail Mary')).toBeNull()
    expect(chapterNumber('Chapter 1: Petrova')).toBeNull()
    expect(chapterNumber('1984')).toBeNull()
    expect(chapterNumber(null)).toBeNull()
  })
})

describe('data sizes', () => {
  it('picks the largest fitting unit', () => {
    expect(dataSize(0, 'en')).toBe('0 B')
    expect(dataSize(830, 'en')).toBe('830 B')
    expect(dataSize(830_000, 'en')).toBe('830 kB')
    expect(dataSize(2_430_000, 'en')).toBe('2.4 MB')
    expect(dataSize(1_500_000_000, 'en')).toBe('1.5 GB')
  })

  it('uses the listener’s decimal separator', () => {
    expect(dataSize(2_430_000, 'sv')).toBe('2,4 MB')
  })
})
