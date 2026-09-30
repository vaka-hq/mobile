import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { database } from '@/library/database'
import { defaultLanguage, isLanguage } from '@/library/languages'
import { defaultAnnasArchiveUrl } from '@/sources/annas-archive/client'
import { defaultAudioBookBayUrl } from '@/sources/audiobookbay/client'
import { defaultLibgenUrl } from '@/sources/libgen/client'

/** Android's player accepts rates up to 2×. */
export const maxPlaybackSpeed = 3

export const playbackSpeeds = [0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.5, 1.75, 2, 2.5, 3] as const

export const skipIntervals = [5, 10, 15, 30, 45, 60] as const

function isSkipInterval(value: number) {
  return skipIntervals.some((interval) => interval === value)
}

/** Values out of range, such as from an edited backup, fall back to their defaults. */
const preferencesSchema = z.object({
  abbBaseUrl: z.string().catch(defaultAudioBookBayUrl),
  /** Where e-books are searched and downloaded; both sites move domains now and then. */
  annasBaseUrl: z.string().catch(defaultAnnasArchiveUrl),
  libgenBaseUrl: z.string().catch(defaultLibgenUrl),
  /**
   * The language audiobooks and e-books are ranked first in, as a code of `languages`; English
   * comes next.
   */
  preferredLanguage: z.string().refine(isLanguage).catch(defaultLanguage),
  /** How the reader sets books: type size in percent, line height, font, theme and layout. */
  readerFontSize: z.number().min(70).max(200).catch(100),
  readerLineHeight: z.number().min(1).max(2.5).catch(1.5),
  readerFont: z.enum(['publisher', 'serif', 'sans']).catch('publisher'),
  readerTheme: z.enum(['auto', 'light', 'dark']).catch('auto'),
  readerMargin: z.number().min(0).max(64).catch(24),
  readerJustify: z.boolean().catch(true),
  /** The library's order and filters, kept between visits: authors and series as JSON lists. */
  librarySort: z.enum(['recent', 'added', 'title', 'author']).catch('recent'),
  libraryStatus: z
    .enum(['all', 'inProgress', 'listening', 'reading', 'notStarted', 'finished'])
    .catch('all'),
  libraryAuthors: z.string().catch('[]'),
  librarySeries: z.string().catch('[]'),
  skipBackSeconds: z.number().refine(isSkipInterval).catch(15),
  skipForwardSeconds: z.number().refine(isSkipInterval).catch(30),
  defaultSpeed: z.number().min(0.5).max(maxPlaybackSpeed).catch(1),
  /** The book the listener stopped and closed; it is not brought back into the mini player. */
  closedBookId: z.string().catch(''),
  /**
   * How listening and reading meet in the same book: `chapters` pairs the audiobook's chapters with
   * the e-book's and keeps the share of the chapter; `words` then listens to a few seconds to find
   * the exact place, with a speech model downloaded when chosen.
   */
  readingSync: z.enum(['off', 'chapters', 'words']).catch('chapters'),
  /** The welcome screens were seen; they show once, on a first start without a TorBox key. */
  onboarded: z.boolean().catch(false),
  /**
   * The listener was told AudioBookBay has stopped answering them, likely a block on their
   * address; they are told again only after it has answered in between.
   */
  abbSilenceNoticed: z.boolean().catch(false),
})

export type Preferences = z.infer<typeof preferencesSchema>

type PreferenceKey = keyof Preferences

function load(): Preferences {
  const rows = database.getAllSync<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  )

  const stored = new Map<string, string | number | boolean>()

  for (const row of rows) {
    try {
      stored.set(
        row.key,
        z.union([z.string(), z.number(), z.boolean()]).parse(JSON.parse(row.value)),
      )
    } catch {
      // A malformed row falls back to its default below.
    }
  }

  return preferencesSchema.parse(Object.fromEntries(stored))
}

let preferences = load()

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function getPreferences() {
  return preferences
}

export function usePreferences() {
  return useSyncExternalStore(subscribe, getPreferences)
}

export async function setPreference<K extends PreferenceKey>(key: K, value: Preferences[K]) {
  preferences = { ...preferences, [key]: value }

  for (const listener of listeners) {
    listener()
  }

  await database.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    JSON.stringify(value),
  )
}

/** The reader's display settings, which the display panel can put back as they started. */
const readerKeys = [
  'readerFontSize',
  'readerLineHeight',
  'readerFont',
  'readerTheme',
  'readerMargin',
  'readerJustify',
] as const

/** The reader's display settings as they start out. */
export const readerDefaults = (() => {
  const defaults = preferencesSchema.parse({})

  return {
    readerFontSize: defaults.readerFontSize,
    readerLineHeight: defaults.readerLineHeight,
    readerFont: defaults.readerFont,
    readerTheme: defaults.readerTheme,
    readerMargin: defaults.readerMargin,
    readerJustify: defaults.readerJustify,
  }
})()

/**
 * Puts the reader's display settings back as they started, all in one change, so the book lays
 * itself out again once rather than for each setting.
 */
export async function resetReaderPreferences() {
  const changed = readerKeys.filter((key) => preferences[key] !== readerDefaults[key])

  if (changed.length === 0) {
    return
  }

  preferences = { ...preferences, ...readerDefaults }

  for (const listener of listeners) {
    listener()
  }

  for (const key of changed) {
    await database.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      key,
      JSON.stringify(readerDefaults[key]),
    )
  }
}

/** A list of names kept as JSON in one preference, such as the library's author filter. */
export function readNames(text: string) {
  try {
    return z.array(z.string()).catch([]).parse(JSON.parse(text))
  } catch {
    return []
  }
}
