import { Directory, File, Paths } from 'expo-file-system'
import { useSyncExternalStore } from 'react'
import { stopIfAborted } from '@/lib/abort'
import { getPreferences } from '@/settings/preferences'
import { Speech } from '../../modules/platform'
import { downloadResuming } from './resumable-download'

/**
 * The offline speech model that finds the exact place between listening and reading. It is never
 * shipped with the app: choosing that mode in Settings downloads it, and it can be removed again.
 * It understands English; books in other languages keep to the chapter estimate.
 */

const modelName = 'vosk-model-small-en-us-0.15'

const modelUrl = `https://alphacephei.com/vosk/models/${modelName}.zip`

/** How large the download is, in bytes: for its progress, and how a complete one is known. */
const speechModelBytes = 41_205_931

export type SpeechModelState =
  | { status: 'missing' }
  | { status: 'downloading'; progress: number }
  | { status: 'ready' }
  | { status: 'failed' }

function directory() {
  return new Directory(Paths.document, 'speech', modelName)
}

function installed() {
  const folder = directory()

  return (
    folder.exists && (new Directory(folder, 'am').exists || new Directory(folder, 'conf').exists)
  )
}

function archive() {
  return new File(Paths.cache, `${modelName}.zip`)
}

/**
 * Deletes what an install cut short leaves: the downloaded archive and a half-unpacked model. A
 * model kept while the mode that uses it is off, such as after restoring a backup, goes too.
 */
function tidy() {
  const partial = new Directory(Paths.document, 'speech', `${modelName}.part`)

  for (const leftover of [archive(), partial]) {
    if (leftover.exists) {
      leftover.delete()
    }
  }

  if (getPreferences().readingSync !== 'words' && directory().exists) {
    directory().delete()
  }
}

tidy()

let state: SpeechModelState = installed() ? { status: 'ready' } : { status: 'missing' }

const listeners = new Set<() => void>()

function set(next: SpeechModelState) {
  state = next

  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function useSpeechModel() {
  return useSyncExternalStore(subscribe, () => state)
}

/** The model's folder when it is installed and this build can use it. */
export function speechModelUri() {
  return Speech && state.status === 'ready' ? directory().uri : null
}

/** Whether the model understands a book in `language`, as its source names it. */
export function speechUnderstands(language: string | null | undefined) {
  return !language || /^(en|eng|english)\b/iu.test(language.trim())
}

let installing: Promise<void> | null = null

/** Stops the install under way, as leaving the mode that uses the model does. */
let stopInstall: AbortController | null = null

/** Downloads and unpacks the model; a second call while one runs waits for it. */
export function installSpeechModel() {
  if (!installing) {
    const stop = new AbortController()

    stopInstall = stop
    installing = install(stop.signal).finally(() => {
      installing = null
      stopInstall = null
    })
  }

  return installing
}

async function install(signal: AbortSignal) {
  if (!Speech) {
    set({ status: 'failed' })
    throw new Error('Speech recognition is not linked into this build')
  }

  const download = archive()
  let lastUpdate = 0

  set({
    status: 'downloading',
    progress: download.exists ? download.size / speechModelBytes : 0,
  })

  try {
    new Directory(Paths.document, 'speech').create({ intermediates: true, idempotent: true })

    // What a failed attempt downloaded is kept, so choosing the mode again carries on from it.
    if (!download.exists || download.size < speechModelBytes) {
      await downloadResuming(
        modelUrl,
        download,
        ({ bytesWritten, totalBytes }) => {
          const now = Date.now()

          if (!signal.aborted && now - lastUpdate > 300) {
            lastUpdate = now
            set({
              status: 'downloading',
              progress: bytesWritten / (totalBytes > 0 ? totalBytes : speechModelBytes),
            })
          }
        },
        signal,
      )
    }
  } catch (error) {
    // Stopped by leaving the mode, which takes what was downloaded with it.
    if (signal.aborted) {
      if (download.exists) {
        download.delete()
      }
    } else {
      set({ status: 'failed' })
    }

    throw error
  }

  try {
    stopIfAborted(signal)
    // Unpacking takes a few seconds; the download is complete meanwhile.
    set({ status: 'downloading', progress: 1 })
    await Speech.installModel(download.uri, directory().uri)
    stopIfAborted(signal)
    set({ status: 'ready' })
  } catch (error) {
    // A model unpacked after the mode was left goes again.
    if (signal.aborted) {
      if (directory().exists) {
        directory().delete()
      }
    } else {
      set({ status: 'failed' })
    }

    throw error
  } finally {
    if (download.exists) {
      download.delete()
    }
  }
}

/** Deletes the model, such as when the listener leaves the mode that uses it. */
export function removeSpeechModel() {
  const folder = directory()

  Speech?.releaseModel()

  if (folder.exists) {
    folder.delete()
  }

  // An install under way stops and deletes what it brought; a download cut short earlier goes too.
  if (stopInstall) {
    stopInstall.abort()
  } else if (archive().exists) {
    archive().delete()
  }

  set({ status: 'missing' })
}
