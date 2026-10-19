import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { getState, seekTo } from '@/player/controller'
import { hardcoverKey } from '@/settings/hardcover-key'
import { getPreferences, setPreference } from '@/settings/preferences'
import {
  addToShelf,
  fetchShelves,
  HardcoverError,
  type HardcoverShelfEntry,
  type HardcoverWork,
  saveReadProgress,
  setShelfStatus,
} from '@/sources/hardcover/client'
import { hardcoverWorks } from './catalog'
import { invalidateLibrary, onLibraryChange } from './invalidation'
import { hardcoverWorkId, workIdOf } from './model'
import {
  addFromShelves,
  finishFromShelves,
  forgetShelves,
  leaveFromShelves,
  moveFromShelves,
  placeFromShelves,
  saveShelfBaseline,
  type ShelfBook,
  shelfBaselines,
  shelfBooks,
} from './shelf-store'
import { planShelf, type ShelfAction } from './shelf-sync'

/**
 * Keeps the library in step with the listener's Hardcover shelves while sync is on in Settings:
 * at start, on returning to the app, soon after the library changes and every few minutes while
 * listening. Each run reads all the shelves in one request and changes only what differs.
 */

export type ShelfSyncState = {
  syncing: boolean
  /** When the last run finished, null before the first. */
  syncedAt: number | null
  /** Why the last run stopped short, until one gets through. */
  error: Error | null
}

let state: ShelfSyncState = { syncing: false, syncedAt: null, error: null }

const listeners = new Set<() => void>()

function update(next: Partial<ShelfSyncState>) {
  state = { ...state, ...next }

  for (const listener of listeners) {
    listener()
  }
}

export function useShelfSync() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    () => state,
  )
}

/** Changes sent there are paced to Hardcover's limit of 60 requests a minute. */
const requestGapMs = 1100

/** A change here is sent this long after it, so a burst of changes goes in one run. */
const settleMs = 10_000

/** While listening, the place is sent at most this often. */
const listeningEveryMs = 5 * 60_000

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Sends one change and waits its turn before the next, so a long run stays under the limit. */
async function send<T>(request: () => Promise<T>) {
  const result = await request()

  await wait(requestGapMs)

  return result
}

/** Carries out a book's plan; returns the shelf entry it leaves there and whether it changed here. */
async function carryOut(
  bookId: number,
  actions: ShelfAction[],
  remote: HardcoverShelfEntry | null,
  book: ShelfBook | undefined,
  details: HardcoverWork | null,
) {
  const workId = book?.workId ?? hardcoverWorkId(bookId)
  let entry = remote
  let changedHere = false

  for (const action of actions) {
    switch (action.kind) {
      case 'addHere':
        if (details) {
          await addFromShelves(workId, details)
          changedHere = true
        }

        break
      case 'finishHere':
        await finishFromShelves(workId, details)
        changedHere = true
        break
      case 'moveHere': {
        const place = await placeFromShelves(
          book?.streamId ?? null,
          action.seconds,
          entry?.read?.editionId ?? null,
          entry?.read?.editionSeconds ?? null,
        )

        const player = getState()
        const open = player.book !== null && workIdOf(player.book) === workId

        // A book playing is not moved under the listener; their listening goes there instead.
        if (!place || (open && player.playing)) {
          break
        }

        // The book open but paused is moved in the player, which would write its own place back.
        if (open && player.book?.id === place.bookId) {
          await seekTo(place.track, place.position)
        } else {
          await moveFromShelves(workId, place)
        }

        changedHere = true
        break
      }

      case 'leaveHere':
        await leaveFromShelves(workId)
        changedHere = true
        break
      case 'addThere': {
        const editionId = book?.local.listening?.editionId ?? null

        entry = await send(() => addToShelf(bookId, editionId, action.status))
        break
      }

      case 'statusThere':
        if (entry) {
          const userBookId = entry.userBookId

          entry = await send(() => setShelfStatus(userBookId, action.status))
        }

        break
      case 'progressThere': {
        const read = entry?.read

        if (entry && read) {
          const seconds = Math.round(action.seconds)

          await send(() => saveReadProgress(read, action.editionId, seconds))
          entry = {
            ...entry,
            read: {
              ...read,
              progressSeconds: seconds,
              editionId: action.editionId ?? read.editionId,
              editionSeconds:
                action.editionId === null || action.editionId === read.editionId
                  ? read.editionSeconds
                  : (book?.local.listening?.recordingSeconds ?? null),
            },
          }
        }

        break
      }
    }
  }

  return { entry, changedHere }
}

/** The details a book needs to show in the library, for the books about to come in. */
async function detailsFor(plans: Map<number, ShelfAction[]>, books: Map<number, ShelfBook>) {
  const needed = [...plans].flatMap(([bookId, actions]) =>
    actions.some((action) => action.kind === 'addHere' || action.kind === 'finishHere') &&
    !books.get(bookId)?.hasDetails
      ? [bookId]
      : [],
  )

  return needed.length > 0 ? hardcoverWorks(needed) : new Map<number, HardcoverWork>()
}

async function run() {
  if (!getPreferences().hardcoverShelves || !hardcoverKey.get()) {
    return
  }

  // Listening saved from here on is newer than this run and goes out with the next.
  const startedAt = Date.now()
  const { userId, entries } = await fetchShelves()

  // A key for another account has other shelves; what was known of the last ones goes.
  if (getPreferences().hardcoverShelvesUser !== userId) {
    await forgetShelves()
    await setPreference('hardcoverShelvesUser', userId)
  }

  const remote = new Map(entries.map((entry) => [entry.bookId, entry]))
  const baselines = await shelfBaselines()
  const books = await shelfBooks()
  const ids = new Set([...remote.keys(), ...baselines.keys(), ...books.keys()])
  const plans = new Map<number, ShelfAction[]>()

  for (const bookId of ids) {
    plans.set(
      bookId,
      planShelf(
        remote.get(bookId) ?? null,
        baselines.get(bookId) ?? null,
        books.get(bookId)?.local ?? null,
      ),
    )
  }

  const details = await detailsFor(plans, books)
  let changedHere = false

  for (const [bookId, actions] of plans) {
    const known = baselines.get(bookId) ?? null
    const entry = remote.get(bookId) ?? null
    const book = books.get(bookId)
    const bookDetails = details.get(bookId) ?? null

    if (!entry && !known && actions.length === 0) {
      continue
    }

    // A book to bring in whose details could not be had waits for the next run, baseline and all.
    if (
      !book?.hasDetails &&
      !bookDetails &&
      actions.some((action) => action.kind === 'addHere' || action.kind === 'finishHere')
    ) {
      continue
    }

    const done = await carryOut(bookId, actions, entry, book, bookDetails)

    changedHere ||= done.changedHere
    await saveShelfBaseline(bookId, done.entry, startedAt)
  }

  if (changedHere) {
    invalidateLibrary()
  }
}

let running: Promise<void> | null = null

let rerun = false

/** Syncs now, or once the run under way ends. */
export function syncShelves(): Promise<void> {
  if (running) {
    rerun = true

    return running
  }

  running = (async () => {
    update({ syncing: true })

    try {
      do {
        rerun = false
        await run()
      } while (rerun)

      update({ syncing: false, syncedAt: Date.now(), error: null })
    } catch (error) {
      update({ syncing: false, error: error instanceof Error ? error : new Error(String(error)) })
    } finally {
      running = null
    }
  })()

  return running
}

/** Turns sync on, syncing at once, or off, forgetting what the last sync knew. */
export async function setShelfSync(enabled: boolean) {
  await setPreference('hardcoverShelves', enabled)

  if (enabled) {
    await syncShelves()
  } else {
    await forgetShelves()
    update({ syncedAt: null, error: null })
  }
}

/** Whether a failure says the key cannot be used for the shelves, rather than a passing fault. */
export function isShelfKeyProblem(error: Error | null) {
  return (
    error instanceof HardcoverError &&
    (error.reason === 'missingScope' || error.reason === 'rejectedKey')
  )
}

let settleTimer: ReturnType<typeof setTimeout> | null = null

let started = false

/** Starts keeping the shelves in step for as long as the app runs. */
export function startShelfSync() {
  if (started) {
    return
  }

  started = true

  const soon = () => {
    if (settleTimer) {
      clearTimeout(settleTimer)
    }

    settleTimer = setTimeout(() => {
      settleTimer = null
      void syncShelves()
    }, settleMs)
  }

  onLibraryChange((change) => {
    // The library changing under a run is the run's own doing.
    if (state.syncing || !getPreferences().hardcoverShelves) {
      return
    }

    if (change === 'library' || Date.now() - (state.syncedAt ?? 0) > listeningEveryMs) {
      soon()
    }
  })

  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void syncShelves()
    }
  })

  void syncShelves()
}
