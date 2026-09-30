import { z } from 'zod'
import type { TorBoxFile } from './client'

export const audioFormats = ['m4b', 'm4a', 'mp3'] as const

export type AudioFormat = (typeof audioFormats)[number]

/** One playable file of an audiobook, in listening order. */
export const trackSchema = z.object({
  fileId: z.number(),
  name: z.string(),
  title: z.string(),
  size: z.number(),
  format: z.enum(audioFormats),
})

export type Track = z.infer<typeof trackSchema>

function formatOf(name: string): AudioFormat | null {
  const extension = name.split('.').pop()?.toLowerCase()

  return audioFormats.find((format) => format === extension) ?? null
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** A readable title from a file name: no folders, extension or separator underscores. */
export function trackTitle(name: string) {
  const base = name.split('/').pop() ?? name

  return base
    .replace(/\.[^.]+$/u, '')
    .replaceAll('_', ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The streamable audio files of a torrent, sorted as a listener expects (track 2 before 10). */
export function audioTracks(files: TorBoxFile[]): Track[] {
  const tracks: Track[] = []

  for (const file of files) {
    const format = formatOf(file.name)

    if (format) {
      tracks.push({
        fileId: file.id,
        name: file.name,
        title: trackTitle(file.short_name ?? file.name),
        size: file.size,
        format,
      })
    }
  }

  return tracks.sort((left, right) => collator.compare(left.name, right.name))
}
