import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { hardcoverKey } from '@/settings/hardcover-key'
import { getPreferences, type SyncSourceId, setPreference } from '@/settings/preferences'
import { onLibraryChange } from './invalidation'
import { forgetShelves } from './shelf-store'
import { isShelfKeyProblem, resyncHardcoverShelves, syncHardcoverShelves } from './shelves'

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
  /** Whether a failed run means its key cannot be used, rather than a passing fault. */
  keyProblem: (error: Error) => boolean
}

/** Every source the library can sync with. A new one is added here and named in Settings. */
export const syncSources: Record<SyncSourceId, SyncSource> = {
  hardcover: {
    ready: () => Boolean(hardcoverKey.get()),
    sync: syncHardcoverShelves,
    resync: resyncHardcoverShelves,
    forget: forgetShelves,
    keyProblem: isShelfKeyProblem,
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

  return librarySync ? syncSources[syncSource] : null
}

let running: Promise<void> | null = null

let rerun = false

async function runOnce(kind: 'sync' | 'resync') {
  const source = activeSource()

  if (!source?.ready()) {
    return
  }

  await (kind === 'resync' ? source.resync() : source.sync())
}

function start(kind: 'sync' | 'resync'): Promise<void> {
  if (running) {
    rerun = true

    return running
  }

  running = (async () => {
    update({ syncing: true })

    try {
      await runOnce(kind)

      while (rerun) {
        rerun = false
        await runOnce('sync')
      }

      update({ syncing: false, syncedAt: Date.now(), error: null })
    } catch (error) {
      update({ syncing: false, error: error instanceof Error ? error : new Error(String(error)) })
    } finally {
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
export async function resyncLibrary() {
  await running

  return start('resync')
}

/** Turns sync on, syncing at once, or off, forgetting what the source's runs knew. */
export async function setLibrarySync(enabled: boolean) {
  const { syncSource } = getPreferences()

  await setPreference('librarySync', enabled)

  if (enabled) {
    await syncLibrary()
  } else {
    await syncSources[syncSource].forget()
    update({ syncedAt: null, error: null })
  }
}

/** Chooses the source; one syncing before stops, and the new one syncs at once while sync is on. */
export async function chooseSyncSource(id: SyncSourceId) {
  const { syncSource, librarySync } = getPreferences()
  const previous = syncSources[syncSource]

  if (id === syncSource) {
    return
  }

  await running
  await previous.forget()
  await setPreference('syncSource', id)
  update({ syncedAt: null, error: null })

  if (librarySync) {
    await syncLibrary()
  }
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
    // The library changing under a run is the run's own doing.
    if (state.syncing || !activeSource()) {
      return
    }

    if (change === 'library' || Date.now() - (state.syncedAt ?? 0) > listeningEveryMs) {
      if (settleTimer) {
        clearTimeout(settleTimer)
      }

      settleTimer = setTimeout(() => {
        settleTimer = null
        void syncLibrary()
      }, settleMs)
    }
  })

  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void syncLibrary()
    }
  })

  void syncLibrary()
}
