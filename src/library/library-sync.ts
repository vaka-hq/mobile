import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { hardcoverKey } from '@/settings/hardcover-key'
import { getPreferences, type SyncSourceId, setPreference } from '@/settings/preferences'
import { onLibraryChange } from './invalidation'
import { forgetShelves } from './shelf-store'
import { resyncHardcoverShelves, shelfProblem, syncHardcoverShelves } from './shelves'

/**
 * Keeping the library in step with a service the listener keeps their books on. One source syncs
 * at a time, chosen in Settings → Library; its runs happen at start, on returning to the app, soon
 * after the library changes and every few minutes while listening.
 */

export type SyncSource = {
  /** Whether it can sync, such as once its API key is saved. */
  ready: () => boolean
  /** One run, changing only what differs; throws for a run that could not get through. */
  sync: () => Promise<void>
  /** A run as if for the first time, the source winning wherever it says anything. */
  resync: () => Promise<void>
  /** Forgets what its runs knew, for a source turned off or replaced by another. */
  forget: () => Promise<void>
  /** What a failed run says about the key or the source, or null for a passing fault. */
  problem: (error: Error) => SyncProblem | null
}

/**
 * Why runs keep failing: the source refuses the key, the key may not read or change the library,
 * or the source's request limit is used up for now.
 */
export type SyncProblem = 'rejectedKey' | 'missingAccess' | 'limited'

/** Every source the library can sync with. A new one is added here and named in Settings. */
export const syncSources: Record<SyncSourceId, SyncSource> = {
  hardcover: {
    ready: () => Boolean(hardcoverKey.get()),
    sync: syncHardcoverShelves,
    resync: resyncHardcoverShelves,
    forget: forgetShelves,
    problem: shelfProblem,
  },
}

export type LibrarySyncState = {
  syncing: boolean
  /** When the last run finished, null before the first. */
  syncedAt: number | null
  /** Why the last run stopped short, until one gets through. */
  error: Error | null
}

let state: LibrarySyncState = { syncing: false, syncedAt: null, error: null }

const listeners = new Set<() => void>()

function update(next: Partial<LibrarySyncState>) {
  state = { ...state, ...next }

  for (const listener of listeners) {
    listener()
  }
}

export function useLibrarySync() {
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

/** The source syncing now, or null while sync is off. */
function activeSource() {
  const { librarySync, syncSource } = getPreferences()

  return librarySync && syncSource ? syncSources[syncSource] : null
}

let running: Promise<void> | null = null

/** The run asked for while one is under way, made once it ends; a resync outranks a sync. */
let pending: 'sync' | 'resync' | null = null

/** When the last run ended, whether or not it got through. */
let ranAt = 0

async function runOnce(kind: 'sync' | 'resync') {
  const source = activeSource()

  if (!source?.ready()) {
    return
  }

  await (kind === 'resync' ? source.resync() : source.sync())
}

function start(kind: 'sync' | 'resync'): Promise<void> {
  if (running) {
    pending = pending === 'resync' ? pending : kind

    return running
  }

  running = (async () => {
    update({ syncing: true })

    try {
      for (let next: typeof pending = kind; next; next = pending) {
        pending = null
        await runOnce(next)
      }

      update({ syncing: false, syncedAt: Date.now(), error: null })
    } catch (error) {
      update({ syncing: false, error: error instanceof Error ? error : new Error(String(error)) })
    } finally {
      pending = null
      ranAt = Date.now()
      running = null
    }
  })()

  return running
}

/** Syncs now, or once the run under way ends. */
export function syncLibrary() {
  return start('sync')
}

/** Syncs everything again from the source, after the run under way. */
export function resyncLibrary() {
  return start('resync')
}

/** Turns sync on, syncing at once, or off, forgetting what the source's runs knew. */
export async function setLibrarySync(enabled: boolean) {
  const { syncSource } = getPreferences()

  if (!syncSource) {
    return
  }

  await setPreference('librarySync', enabled)

  if (enabled) {
    await syncLibrary()
  } else {
    // A run under way would save what it learnt after it was forgotten.
    await running
    await syncSources[syncSource].forget()
    update({ syncedAt: null, error: null })
  }
}

/**
 * Chooses the source, or none. The one before stops and forgets what it knew, and sync is off
 * until the listener turns it on for the new one.
 */
export async function chooseSyncSource(id: SyncSourceId | null) {
  const { syncSource } = getPreferences()

  if (id === syncSource) {
    return
  }

  // Off first, so no run starts for the source before it is forgotten.
  await setPreference('librarySync', false)
  await running

  if (syncSource) {
    await syncSources[syncSource].forget()
  }

  await setPreference('syncSource', id)
  update({ syncedAt: null, error: null })
}

/** A change here is sent this long after it, so a burst of changes goes in one run. */
const settleMs = 10_000

/** While listening, the place is sent at most this often. */
const listeningEveryMs = 5 * 60_000

let settleTimer: ReturnType<typeof setTimeout> | null = null

let started = false

/** Starts keeping the library in step for as long as the app runs. */
export function startLibrarySync() {
  if (started) {
    return
  }

  started = true

  onLibraryChange((change) => {
    if (!activeSource()) {
      return
    }

    // Listening saves its place every few seconds; were each to put the run off, none would come.
    // A run moving a book's place is heard as listening too, so listening waits out a run. The
    // run's own changes to the library are not heard, so the listener's made meanwhile follow it.
    if (
      change === 'listening' &&
      (state.syncing || settleTimer || Date.now() - ranAt < listeningEveryMs)
    ) {
      return
    }

    if (settleTimer) {
      clearTimeout(settleTimer)
    }

    settleTimer = setTimeout(() => {
      settleTimer = null
      void syncLibrary()
    }, settleMs)
  })

  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void syncLibrary()
    }
  })

  void syncLibrary()
}
