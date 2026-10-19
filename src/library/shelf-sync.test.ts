import { describe, expect, it } from 'vitest'
import type { HardcoverShelfEntry } from '@/sources/hardcover/client'
import { type LocalBook, planShelf, remoteProgress, type ShelfBaseline } from './shelf-sync'

const hour = 3600

function entry(overrides: Partial<HardcoverShelfEntry> = {}): HardcoverShelfEntry {
  return { userBookId: 10, bookId: 7, status: 2, editionId: 50, read: null, ...overrides }
}

function read(progressSeconds: number | null, editionSeconds: number | null = 10 * hour) {
  return { id: 99, startedAt: '2026-10-19', progressSeconds, editionId: 50, editionSeconds }
}

function baseline(remote: HardcoverShelfEntry, syncedAt = 1000): ShelfBaseline {
  return {
    userBookId: remote.userBookId,
    status: remote.status,
    readId: remote.read?.id ?? null,
    progressSeconds: remote.read?.progressSeconds ?? null,
    syncedAt,
  }
}

function local(overrides: Partial<LocalBook> = {}): LocalBook {
  return { inLibrary: true, finishedAt: null, playedAt: null, listening: null, ...overrides }
}

function listening(seconds: number, savedAt: number, editionId: number | null = 50) {
  return { seconds, savedAt, editionId, recordingSeconds: 10 * hour }
}

describe('a book only on Hardcover', () => {
  it('comes into the library where it stands there', () => {
    const remote = entry({ read: read(2 * hour) })

    expect(planShelf(remote, null, null)).toEqual([
      { kind: 'addHere' },
      { kind: 'moveHere', share: 0.2, seconds: 2 * hour },
    ])
  })

  it('comes in finished when it was read', () => {
    expect(planShelf(entry({ status: 3 }), null, null)).toEqual([
      { kind: 'addHere' },
      { kind: 'finishHere' },
    ])
  })

  it('comes in unstarted when it is only wanted', () => {
    expect(planShelf(entry({ status: 1 }), null, null)).toEqual([{ kind: 'addHere' }])
  })
})

describe('a book only here', () => {
  it('goes on the shelves as wanted when it was only added', () => {
    expect(planShelf(null, null, local())).toEqual([{ kind: 'addThere', status: 1 }])
  })

  it('goes on the shelves as listened to, with its place', () => {
    const book = local({ playedAt: 2000, listening: listening(hour, 2000) })

    expect(planShelf(null, null, book)).toEqual([
      { kind: 'addThere', status: 2 },
      { kind: 'progressThere', seconds: hour, editionId: 50 },
    ])
  })

  it('goes on the shelves as read when it was finished', () => {
    expect(planShelf(null, null, local({ finishedAt: 3000, playedAt: 2000 }))).toEqual([
      { kind: 'addThere', status: 3 },
    ])
  })

  it('stays off the shelves when it is not in the library', () => {
    expect(planShelf(null, null, local({ inLibrary: false }))).toEqual([])
  })
})

describe('Hardcover as the source of truth', () => {
  it('moves listening here when the read moved there, over listening here since', () => {
    const before = entry({ read: read(hour) })
    const after = entry({ read: read(5 * hour) })
    const book = local({ playedAt: 500, listening: listening(2 * hour, 2000) })

    expect(planShelf(after, baseline(before), book)).toEqual([
      { kind: 'moveHere', share: 0.5, seconds: 5 * hour },
    ])
  })

  it('finishes the book here when it was marked read there', () => {
    const before = entry({ read: read(hour) })
    const after = entry({ status: 3, read: null })

    expect(planShelf(after, baseline(before), local({ playedAt: 500 }))).toEqual([
      { kind: 'finishHere' },
    ])
  })

  it('takes a book taken off the shelves out of the library', () => {
    expect(planShelf(null, baseline(entry()), local())).toEqual([{ kind: 'leaveHere' }])
  })

  it('never takes anything off the shelves when the book leaves the library here', () => {
    const remote = entry({ read: read(hour) })

    expect(planShelf(remote, baseline(remote), local({ inLibrary: false }))).toEqual([])
  })

  it('leaves listening here alone when it already stands at the read', () => {
    const before = entry({ status: 1 })
    const after = entry({ read: read(hour + 10) })

    expect(planShelf(after, baseline(before), local({ listening: listening(hour, 500) }))).toEqual(
      [],
    )
  })
})

describe('changes made here', () => {
  it('saves listening further on in the open read', () => {
    const remote = entry({ read: read(hour) })
    const book = local({ playedAt: 500, listening: listening(2 * hour, 2000) })

    expect(planShelf(remote, baseline(remote), book)).toEqual([
      { kind: 'progressThere', seconds: 2 * hour, editionId: 50 },
    ])
  })

  it('sends nothing for a place saved before the last sync', () => {
    const remote = entry({ read: read(hour) })
    const book = local({ playedAt: 500, listening: listening(2 * hour, 900) })

    expect(planShelf(remote, baseline(remote), book)).toEqual([])
  })

  it('starts listening again on a book read before', () => {
    const remote = entry({ status: 3 })
    const book = local({ playedAt: 2000, listening: listening(600, 2100) })

    expect(planShelf(remote, baseline(remote), book)).toEqual([
      { kind: 'statusThere', status: 2 },
      { kind: 'progressThere', seconds: 600, editionId: 50 },
    ])
  })

  it('marks the book read once it is finished here', () => {
    const remote = entry({ read: read(hour) })
    const book = local({ playedAt: 500, finishedAt: 2000, listening: listening(9 * hour, 2000) })

    expect(planShelf(remote, baseline(remote), book)).toEqual([{ kind: 'statusThere', status: 3 }])
  })

  it('fills in what only this phone knew when Hardcover first has the book', () => {
    const book = local({ playedAt: 500, listening: listening(hour, 600) })

    expect(planShelf(entry({ status: 1 }), null, book)).toEqual([
      { kind: 'statusThere', status: 2 },
      { kind: 'progressThere', seconds: hour, editionId: 50 },
    ])
  })
})

describe('remoteProgress', () => {
  it('keeps the recording’s own edition when it has one', () => {
    expect(remoteProgress(listening(hour, 0, 77), read(0))).toEqual({
      seconds: hour,
      editionId: 77,
    })
  })

  it('carries the share over to the read’s edition for a recording without one', () => {
    expect(remoteProgress(listening(hour, 0, null), read(0, 20 * hour))).toEqual({
      seconds: 2 * hour,
      editionId: 50,
    })
  })
})
