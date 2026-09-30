import type { AudioFormat } from '@/sources/torbox/tracks'
import { readMp3 } from './mp3'
import { readMp4 } from './mp4'
import { httpSource } from './source'

/** A chapter marker inside one file, in seconds from the start of that file. */
export type MediaChapter = {
  title: string
  start: number
}

export type MediaInfo = {
  duration: number | null
  chapters: MediaChapter[]
}

/** Reads the duration and embedded chapters of a streamed file without downloading the audio. */
export function readMediaInfo(url: string, format: AudioFormat, signal?: AbortSignal) {
  const source = httpSource(url, signal)

  return format === 'mp3' ? readMp3(source) : readMp4(source)
}
