import { requireOptionalNativeModule } from 'expo'

/** A word heard in the audio, with when it starts and ends in the file, in seconds. */
export type HeardWord = { word: string; start: number; end: number }

export type SnippetRequest = {
  /** An http(s) URL to stream from, or a file URI on the phone. */
  source: string
  headers?: Record<string, string>
  /** Where the stretch starts in the file, in seconds. */
  start: number
  /** How long it is, in seconds, at most two minutes. */
  duration: number
  /** The unpacked model's directory, as a file URI. */
  model: string
}

type SpeechModule = {
  /**
   * Unpacks a downloaded Vosk model archive into `directory`. Rejects with `ERR_SPEECH_MODEL`
   * when the archive holds no model.
   */
  installModel(archive: string, directory: string): Promise<void>
  /**
   * The words spoken in a stretch of an audiobook, offline. Rejects with `ERR_SPEECH_MODEL` when
   * the model is missing or broken, and `ERR_SPEECH_AUDIO` when the audio cannot be read.
   */
  transcribe(request: SnippetRequest): Promise<{ words: HeardWord[] }>
  /** Lets go of the model in memory; it is otherwise kept a minute after its last use. */
  releaseModel(): void
}

/** Null where the native module is not linked, such as in tests; callers then do without. */
export const Speech = requireOptionalNativeModule<SpeechModule>('Speech')
