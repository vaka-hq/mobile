import { describe, expect, it } from 'vitest'
import {
  audioParts,
  isAside,
  listeningToReading,
  locatePassage,
  pairParts,
  readingToListening,
  titleKey,
} from './reading-sync'

describe('titleKey', () => {
  it('reads chapter numbers however they are written', () => {
    expect(titleKey('Chapter 12')).toBe('n:12')
    expect(titleKey('CHAPTER TWELVE')).toBe('n:12')
    expect(titleKey('Kapitel XII')).toBe('n:12')
    expect(titleKey('12')).toBe('n:12')
    expect(titleKey('Project Hail Mary - Chapter 3')).toBe('n:3')
  })

  it('falls back to the words of a named part', () => {
    expect(titleKey('Epilogue')).toBe('t:epilogue')
    expect(titleKey('The Long Night')).toBe('t:the long night')
  })
})

describe('isAside', () => {
  it('knows credits and front matter from the story', () => {
    expect(isAside('Opening Credits')).toBe(true)
    expect(isAside('Copyright')).toBe(true)
    expect(isAside('About the Author')).toBe(true)
    expect(isAside('Prologue')).toBe(false)
    expect(isAside('Chapter 1')).toBe(false)
  })
})

describe('pairParts', () => {
  it('pairs by title, skipping what only one side has', () => {
    const audio = ['Opening Credits', 'Chapter 1', 'Chapter 2', 'End Credits']
    const text = ['Cover', 'Copyright', 'One', 'Two', 'Acknowledgments']

    expect(pairParts(audio, text)).toEqual([null, 2, 3, null])
  })

  it('pairs by order between titles that do not say what they are', () => {
    const audio = ['Track 01', 'Prologue', 'Track 03', 'Track 04']
    const text = ['Cover', 'Prologue', 'The Beginning', 'The Middle']

    expect(pairParts(audio, text)).toEqual([null, 1, 2, 3])
  })
})

const audio = [
  { title: 'Opening Credits', start: 0, end: 30 },
  { title: 'Chapter 1', start: 30, end: 630 },
  { title: 'Chapter 2', start: 630, end: 1830 },
]

const sections = [
  { label: 'Copyright', fraction: 0 },
  { label: 'Chapter One', fraction: 0.02 },
  { label: 'Chapter Two', fraction: 0.4 },
]

describe('listeningToReading', () => {
  it('keeps the share of the chapter', () => {
    // Halfway through chapter 2, which runs from 0.4 to the end.
    const place = listeningToReading(audio, sections, 1230)

    expect(place?.label).toBe('Chapter Two')
    expect(place?.fraction).toBeCloseTo(0.7)
  })

  it('goes both ways', () => {
    const listening = readingToListening(audio, sections, 0.7)

    expect(listening?.title).toBe('Chapter 2')
    expect(listening?.seconds).toBeCloseTo(1230)
  })

  it('keeps the share of the book when no chapter pairs', () => {
    const place = listeningToReading(
      [{ title: 'Track 1', start: 0, end: 100 }],
      [
        { label: 'Everything', fraction: 0 },
        { label: 'More', fraction: 0.5 },
      ],
      50,
    )

    expect(place?.fraction).toBeCloseTo(0.5)
  })
})

describe('audioParts', () => {
  it('places chapters over the whole book once lengths are known', () => {
    expect(
      audioParts(
        [
          { title: 'A', track: 0, start: 0 },
          { title: 'B', track: 1, start: 0 },
        ],
        [100, 50],
      ),
    ).toEqual([
      { title: 'A', start: 0, end: 100 },
      { title: 'B', start: 100, end: 150 },
    ])
    expect(audioParts([{ title: 'A', track: 0, start: 0 }], [null])).toBeNull()
  })

  it('places what it can when some files have no known length', () => {
    expect(
      audioParts(
        [
          { title: 'A', track: 0, start: 0 },
          { title: 'B', track: 1, start: 0 },
          { title: 'C', track: 2, start: 0 },
        ],
        [100, null, 50],
      ),
    ).toEqual([{ title: 'A', start: 0, end: 100 }])
  })
})

describe('locatePassage', () => {
  const heard = 'and then the ship turned slowly toward the distant star while rocky watched'
    .split(' ')
    .map((word, index) => ({ word, start: 100 + index, end: 100.8 + index }))

  it('finds when a passage starts in what was heard', () => {
    expect(locatePassage('The ship turned slowly toward the distant star.', heard)).toBe(102)
  })

  it('does not trust a single shared run', () => {
    expect(locatePassage('Nothing like the ship turned here at all', heard)).toBeNull()
  })
})
