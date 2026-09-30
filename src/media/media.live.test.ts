import { describe, expect, it } from 'vitest'
import { readMediaInfo } from './media-info'

// Public-domain LibriVox recordings; reaches archive.org, run with `vp run test:live`.
const m4b = 'https://archive.org/download/timemachine_sjm_librivox/TimeMachineV1_64kb_librivox.m4b'

const mp3 = 'https://archive.org/download/timemachine_sjm_librivox/timemachine_01_wells_64kb.mp3'

describe('media metadata (live)', () => {
  it('reads the chapters and length of a real M4B with range requests', async () => {
    const info = await readMediaInfo(m4b, 'm4b')

    expect(info.duration).toBeGreaterThan(3600)
    expect(info.chapters.length).toBeGreaterThan(5)
    expect(info.chapters[0]?.start).toBe(0)
    expect(
      info.chapters.every(
        (chapter, index, all) => index === 0 || chapter.start > (all[index - 1]?.start ?? 0),
      ),
    ).toBe(true)
  }, 60_000)

  it('measures a real MP3', async () => {
    const info = await readMediaInfo(mp3, 'mp3')

    // archive.org lists this file as 21:20.
    expect(info.duration).toBeGreaterThan(1270)
    expect(info.duration).toBeLessThan(1290)
  }, 60_000)
})
