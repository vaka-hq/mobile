import { DownloadTask, File } from 'expo-file-system'
import { stopIfAborted } from '@/lib/abort'

/** How many attempts in a row may bring no new bytes before the download gives up. */
const attemptsWithoutProgress = 4

type Progress = { bytesWritten: number; totalBytes: number }

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sizeOf(file: File) {
  return file.exists ? file.size : 0
}

/**
 * Downloads `url` into `file`, carrying on from what the file already holds. A connection that
 * drops or goes quiet partway, as on a phone's network, is picked up again with a range request
 * rather than started over; it gives up only once several attempts in a row bring nothing new.
 * A file that fails or is stopped keeps what arrived, so a later call carries on from there too.
 *
 * `File.downloadFileAsync` is not used: it gives up after ten quiet seconds and starts over.
 */
export async function downloadResuming(
  url: string,
  file: File,
  onProgress: (progress: Progress) => void,
  signal: AbortSignal,
) {
  let fruitless = 0

  for (;;) {
    stopIfAborted(signal)

    const offset = sizeOf(file)

    const task =
      offset > 0
        ? DownloadTask.fromSavable(
            { url, fileUri: file.uri, isDirectory: false, resumeData: String(offset) },
            { onProgress, signal },
          )
        : File.createDownloadTask(url, file, { onProgress, signal })

    try {
      await (offset > 0 ? task.resumeAsync() : task.downloadAsync())

      return
    } catch (error) {
      // Asked to carry on past the end, the server says no range is left: the file is whole.
      if (offset > 0 && error instanceof Error && error.message.includes('HTTP 416')) {
        return
      }

      fruitless = sizeOf(file) > offset ? 0 : fruitless + 1

      if (signal.aborted || fruitless >= attemptsWithoutProgress) {
        throw error
      }

      await wait(1000 * 2 ** fruitless)
    } finally {
      task.release()
    }
  }
}
