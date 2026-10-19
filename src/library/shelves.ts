import { getState, seekTo } from '@/player/controller'
import { hardcoverKey } from '@/settings/hardcover-key'
import { getPreferences, setPreference } from '@/settings/preferences'
import {
  addToShelf,
  fetchShelves,
  HardcoverError,
  HardcoverNotConnectedError,
  type HardcoverShelfEntry,
  type HardcoverWork,
  saveReadProgress,
  setShelfStatus,
} from '@/sources/hardcover/client'
import { hardcoverWorks } from './catalog'
import { invalidateLibrary } from './invalidation'
import type { SyncProblem } from './library-sync'
import { hardcoverWorkId, workIdOf } from './model'
import {
  addFromShelves,
  finishFromShelves,
  forgetShelves,
  leaveFromShelves,
  moveFromShelves,
  placeFromShelves,
  restartFromShelves,
  saveShelfBaseline,
  type ShelfBook,
  shelfBaselines,
  shelfBooks,
} from './shelf-store'
import { planShelf, type ShelfAction } from './shelf-sync'

/**
 * Hardcover as the library's sync source: the listener's shelves, kept in step book by book. When
 * runs happen is up to `library-sync.ts`.
 */

/** Changes sent there are paced to Hardcover's limit of 60 requests a minute. */
const requestGapMs = 1100

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Sends one change and waits its turn before the next, so a long run stays under the limit. */
async function send<T>(request: () => Promise<T>) {
  const result = await request()

  await wait(requestGapMs)

  return result
}

/**
 * Writes refused for the key, such as one that may read the shelves but not change them. The
 * rest of the run still brings Hardcover's changes here; the refused writes wait for a key that
 * may make them.
 */
type Writes = { refused: HardcoverError | null }

/**
 * Carries out a book's plan; returns the shelf entry it leaves there, whether it changed here, and
 * whether a change was held back, either way, so the book's baseline stays and the next run tries
 * it again.
 */
async function carryOut(
  bookId: number,
  actions: ShelfAction[],
  remote: HardcoverShelfEntry | null,
  book: ShelfBook | undefined,
  details: HardcoverWork | null,
  writes: Writes,
) {
  const workId = book?.workId ?? hardcoverWorkId(bookId)
  let heldBack = false

  /** Sends a change there unless the key's writes are refused; null when it was not sent. */
  async function write<T>(request: () => Promise<T>) {
    if (writes.refused) {
      heldBack = true

      return null
    }

    try {
      return await send(request)
    } catch (error) {
      if (error instanceof HardcoverError && isShelfKeyProblem(error)) {
        writes.refused = error
        heldBack = true

        return null
      }

      throw error
    }
  }

  let entry = remote
  let changedHere = false

  for (const action of actions) {
    switch (action.kind) {
      case 'addHere':
        // A book known here already has its details; one new here needs them fetched.
        if (details || book?.hasDetails) {
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

        // A book playing is not moved under the listener; it moves once they pause, as Hardcover
        // still wins.
        if (open && player.playing) {
          heldBack = true
          break
        }

        // A recording whose length is not known yet starts at the place once it opens.
        if (!place) {
          if (!open && book?.local.finishedAt) {
            await restartFromShelves(workId, bookId)
            changedHere = true
          }

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

      case 'restartHere': {
        const openBook = getState().book

        // The book open in the player would write its own finished place back; it restarts once
        // another book is open.
        if (!openBook || workIdOf(openBook) !== workId) {
          await restartFromShelves(workId, bookId)
          changedHere = true
        } else {
          heldBack = true
        }

        break
      }

      case 'leaveHere':
        await leaveFromShelves(workId)
        changedHere = true
        break
      case 'addThere': {
        const editionId = book?.local.listening?.editionId ?? null

        entry = (await write(() => addToShelf(bookId, editionId, action.status))) ?? entry
        break
      }

      case 'statusThere':
        if (entry) {
          const userBookId = entry.userBookId

          entry = (await write(() => setShelfStatus(userBookId, action.status))) ?? entry
        }

        break
      case 'progressThere': {
        const read = entry?.read

        if (entry && read) {
          const seconds = Math.round(action.seconds)

          const saved = await write(async () => {
            await saveReadProgress(read, action.editionId, seconds)

            return true
          })

          if (!saved) {
            break
          }

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

  return { entry, changedHere, heldBack }
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

/**
 * One run: reads all the shelves in one request and carries out each book's plan. Throws for a
 * run that could not get through, such as without a key or with one lacking library access.
 */
export async function syncHardcoverShelves() {
  if (!hardcoverKey.get()) {
    throw new HardcoverNotConnectedError()
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
  const writes: Writes = { refused: null }
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

    const done = await carryOut(bookId, actions, entry, book, bookDetails, writes)

    changedHere ||= done.changedHere

    // A book with a change held back keeps its baseline, so the change is made once it can be.
    if (!done.heldBack) {
      await saveShelfBaseline(bookId, done.entry, startedAt)
    }
  }

  if (changedHere) {
    invalidateLibrary()
  }

  // Said once the run is over, so the listener learns their key cannot change the shelves.
  if (writes.refused) {
    throw writes.refused
  }
}

/** Syncs afresh, as if for the first time: Hardcover's shelves win wherever they say anything. */
export async function resyncHardcoverShelves() {
  await forgetShelves()
  await syncHardcoverShelves()
}

/** Whether a failure says the key cannot be used for the shelves, rather than a passing fault. */
function isShelfKeyProblem(error: HardcoverError) {
  return error.reason === 'missingScope' || error.reason === 'rejectedKey'
}

/** What a failed run says about the key or Hardcover, for Settings; null for a passing fault. */
export function shelfProblem(error: Error): SyncProblem | null {
  if (!(error instanceof HardcoverError)) {
    return null
  }

  switch (error.reason) {
    case 'rejectedKey':
      return 'rejectedKey'
    case 'missingScope':
      return 'missingAccess'
    case 'rateLimited':
      return 'limited'
    case 'other':
      return null
  }
}
