import { describe, expect, it } from 'vitest'
import { audioTracks, trackTitle } from './tracks'

describe('TorBox audio tracks', () => {
  it('keeps only streamable audio and sorts it naturally', () => {
    const tracks = audioTracks([
      { id: 1, name: 'Book/cover.jpg', size: 10 },
      { id: 2, name: 'Book/Chapter 10.mp3', size: 30 },
      { id: 3, name: 'Book/Chapter 2.MP3', size: 20 },
      { id: 4, name: 'Book/notes.nfo', size: 1 },
      { id: 5, name: 'Book/Part_1.m4b', short_name: 'Part_1.m4b', size: 50 },
    ])

    expect(tracks.map((track) => track.fileId)).toEqual([3, 2, 5])
    expect(tracks[0]).toEqual({
      fileId: 3,
      name: 'Book/Chapter 2.MP3',
      title: 'Chapter 2',
      size: 20,
      format: 'mp3',
    })
    expect(tracks[2]?.format).toBe('m4b')
  })

  it('derives readable titles from paths', () => {
    expect(trackTitle('Get_Lost/Get_Lost.m4b')).toBe('Get Lost')
    expect(trackTitle('01 - Opening.mp3')).toBe('01 - Opening')
  })
})
