import { Directory, File, Paths } from 'expo-file-system'
import { useSyncExternalStore } from 'react'
import { getPreferences } from '@/settings/preferences'
import { Speech } from '../../modules/speech'

/**
 * The offline speech model that finds the exact place between listening and reading. It is never
 * shipped with the app: choosing that mode in Settings downloads it, and it can be removed again.
 * It understands English; books in other languages keep to the chapter estimate.
 */

const modelName = 'vosk-model-small-en-us-0.15'

const modelUrl = `https://alphacephei.com/vosk/models/${modelName}.zip`

/** About how large the download is, for the setting that offers it, in bytes. */
export const speechModelBytes = 41_205_931

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

/** Downloads and unpacks the model; a second call while one runs waits for it. */
export function installSpeechModel() {
  installing ??= install().finally(() => {
    installing = null
  })

  return installing
}

async function install() {
  if (!Speech) {
    set({ status: 'failed' })
    throw new Error('Speech recognition is not linked into this build')
  }

  const download = archive()
  let lastUpdate = 0

  set({ status: 'downloading', progress: 0 })

  try {
    new Directory(Paths.document, 'speech').create({ intermediates: true, idempotent: true })
    await File.downloadFileAsync(modelUrl, download, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const now = Date.now()

        if (now - lastUpdate > 300) {
          lastUpdate = now
          set({
            status: 'downloading',
            progress: bytesWritten / (totalBytes > 0 ? totalBytes : speechModelBytes),
          })
        }
      },
    })
    await Speech.installModel(download.uri, directory().uri)
    set({ status: 'ready' })
  } catch (error) {
    set({ status: 'failed' })
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

  set({ status: 'missing' })
}
