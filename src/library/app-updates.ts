import * as Application from 'expo-application'
import { Directory, File, Paths } from 'expo-file-system'
import { useSyncExternalStore } from 'react'
import { getPreferences, setPreference } from '@/settings/preferences'
import { listReleases, readUpdateManifest, type ReleaseAsset } from '@/sources/github/client'
import { AppUpdates } from '../../modules/app-updates'
import { apkFor, manifestOf, releaseFor } from './update-release'

/** A newer build than the one running, on the listener's channel. */
export type AvailableUpdate = {
  versionName: string
  versionCode: number
  /** The release's page, with what changed. */
  pageUrl: string
  apk: ReleaseAsset
}

/** Why an update could not go ahead. */
export type UpdateProblem = 'check' | 'download' | 'checksum' | 'install'

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'current' }
  | { phase: 'available'; update: AvailableUpdate }
  | { phase: 'downloading'; update: AvailableUpdate; progress: number }
  | { phase: 'installing'; update: AvailableUpdate }
  | { phase: 'failed'; update: AvailableUpdate | null; problem: UpdateProblem }

/**
 * Only the production app updates itself: the others are built on the owner's computer, under
 * their own package names, and never published.
 */
export const updatesSupported =
  AppUpdates !== null && Application.applicationId === 'app.vaka.android'

/** How often updates are looked for on their own, when the app starts. */
const checkInterval = 24 * 60 * 60 * 1000

let state: UpdateState = { phase: 'idle' }

/** Whether the update dialog is open over the app. */
let dialogOpen = false

let download: AbortController | null = null

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function set(next: UpdateState, open = dialogOpen) {
  state = next
  dialogOpen = open

  for (const listener of listeners) {
    listener()
  }
}

export function useUpdateState() {
  return useSyncExternalStore(subscribe, () => state)
}

export function useUpdateDialogOpen() {
  return useSyncExternalStore(subscribe, () => dialogOpen)
}

function installedVersionCode() {
  return Number(Application.nativeBuildVersion ?? 0)
}

/** The newest build on the channel when it is newer than the one running, else null. */
async function findUpdate(): Promise<AvailableUpdate | null> {
  const release = releaseFor(await listReleases(), getPreferences().updateChannel)
  const manifest = release ? manifestOf(release) : null
  const apk = release && AppUpdates ? apkFor(release, AppUpdates.supportedAbis()) : null

  if (!release || !manifest || !apk) {
    return null
  }

  const { versionName, versionCode } = await readUpdateManifest(manifest.url)

  return versionCode > installedVersionCode()
    ? { versionName, versionCode, pageUrl: release.pageUrl, apk }
    : null
}

/**
 * Looks for a newer build on the listener's channel and offers it in the dialog, unless it is one
 * they put off and they did not ask. A failed look is only shown where they asked for it.
 */
export async function checkForUpdates({ asked }: { asked: boolean }) {
  if (
    !updatesSupported ||
    state.phase === 'checking' ||
    state.phase === 'downloading' ||
    state.phase === 'installing'
  ) {
    return
  }

  set({ phase: 'checking' })

  try {
    const update = await findUpdate()

    void setPreference('updatesCheckedAt', Date.now())

    if (update) {
      set(
        { phase: 'available', update },
        asked || update.versionCode !== getPreferences().updateDeclined,
      )
    } else {
      set({ phase: 'current' })
    }
  } catch {
    set({ phase: 'failed', update: null, problem: 'check' }, false)
  }
}

/** Looks for updates on start, at most once a day. */
export function checkForUpdatesDaily() {
  if (Date.now() - getPreferences().updatesCheckedAt >= checkInterval) {
    void checkForUpdates({ asked: false })
  }
}

/** Opens the dialog for the update found, such as from Settings. */
export function showUpdate() {
  if (state.phase !== 'idle' && state.phase !== 'checking' && state.phase !== 'current') {
    set(state, true)
  }
}

/** Puts the update off: its dialog closes, and it is not offered again until asked for. */
export function declineUpdate() {
  if (state.phase === 'available') {
    void setPreference('updateDeclined', state.update.versionCode)
  }

  set(state, false)
}

/** Closes the dialog, stopping a download under way. */
export function closeUpdateDialog() {
  if (state.phase === 'downloading') {
    download?.abort()
  } else {
    set(state, false)
  }
}

/** Whether the app may install apps; without it Android refuses its update. */
export function canInstallUpdates() {
  return AppUpdates?.canInstall() ?? false
}

/** Opens the system setting that lets the app install its updates. */
export function allowInstallingUpdates() {
  AppUpdates?.openInstallSettings()
}

function updatesDirectory() {
  return new Directory(Paths.cache, 'updates')
}

/**
 * Downloads the update, checks it against the checksum GitHub keeps for it, and hands it to
 * Android's installer, which replaces the running app once the listener confirms.
 */
export async function installUpdate() {
  if ((state.phase !== 'available' && state.phase !== 'failed') || !state.update || !AppUpdates) {
    return
  }

  const update = state.update
  const controller = new AbortController()
  const directory = updatesDirectory()

  download = controller
  set({ phase: 'downloading', update, progress: 0 })

  let file: File

  try {
    // Only the update being installed is kept; an earlier one would never be used.
    if (directory.exists) {
      directory.delete()
    }

    directory.create({ intermediates: true, idempotent: true })
    file = new File(directory, update.apk.name)

    let lastUpdate = 0

    await File.downloadFileAsync(update.apk.url, file, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten }) => {
        const now = Date.now()

        // Twice a second is enough for a progress bar.
        if (!controller.signal.aborted && now - lastUpdate > 500) {
          lastUpdate = now
          set({ phase: 'downloading', update, progress: bytesWritten / update.apk.size })
        }
      },
    })
  } catch {
    download = null
    set(
      controller.signal.aborted
        ? { phase: 'available', update }
        : { phase: 'failed', update, problem: 'download' },
      !controller.signal.aborted,
    )

    return
  }

  download = null

  try {
    const checksum = await AppUpdates.sha256(file.uri)

    if (update.apk.sha256 === null || checksum !== update.apk.sha256) {
      file.delete()
      set({ phase: 'failed', update, problem: 'checksum' })

      return
    }

    set({ phase: 'installing', update })
    await AppUpdates.install(file.uri)
  } catch {
    set({ phase: 'failed', update, problem: 'install' })
  }
}

// The installer's answer: declining its confirmation leaves the update on offer.
AppUpdates?.addListener('onInstallStatus', ({ status }) => {
  if (state.phase !== 'installing') {
    return
  }

  if (status === 'cancelled') {
    set({ phase: 'available', update: state.update })
  } else if (status === 'failed') {
    set({ phase: 'failed', update: state.update, problem: 'install' })
  } else {
    set({ phase: 'idle' }, false)
  }
})
