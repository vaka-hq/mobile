import { useLingui } from '@lingui/react/macro'
import { ZodError } from 'zod'
import { HttpError, NetworkError, TimeoutError } from '@/lib/http'
import { ProxyAuthError } from '@/lib/proxied-http'
import { AbbSilentError } from '@/library/abb-reader'
import { BackupFormatError } from '@/library/backup'
import { NotStreamableError, UnexpectedAnswerError } from '@/library/errors'
import { ReadBudgetExceededError } from '@/media/source'
import { PlaybackError } from '@/player/controller'
import { TorBoxKeyMissingError } from '@/settings/torbox-key'
import { AnnasKeyError } from '@/sources/annas-archive/client'
import { HardcoverError, HardcoverNotConnectedError } from '@/sources/hardcover/client'
import { TorBoxQueuedError } from '@/sources/torbox/client'

/**
 * Words an error for the listener, in their language. Errors are thrown in English for the code
 * and logs; the screens show this instead, so no raw or untranslated message reaches them.
 */
export function useErrorText() {
  const { t } = useLingui()

  return (error: Error | null | undefined, fallback?: string): string => {
    if (error instanceof TorBoxKeyMissingError) {
      return t({
        message: 'Add your streaming API key in Settings to listen.',
        comment: 'Error when listening needs the streaming service key, which is not set',
      })
    }

    if (error instanceof HardcoverNotConnectedError) {
      return t({
        message: 'Add your Hardcover API key in Settings to load book details.',
        comment: 'Error when book details need a Hardcover key, which is not set',
      })
    }

    if (error instanceof HardcoverError && error.reason === 'rateLimited') {
      return t({
        message: 'Hardcover is busy. Try again in a minute.',
        comment: 'Hardcover rate limit reached',
      })
    }

    if (error instanceof HardcoverError && error.reason !== 'other') {
      return t({
        message: 'Hardcover no longer accepts your API key. Check it in Settings.',
        comment: 'Error when Hardcover rejects the saved key',
      })
    }

    if (error instanceof AnnasKeyError) {
      return t({
        message: 'Anna’s Archive no longer accepts your member key.',
        comment: 'Startup alert: the Anna’s Archive key was rejected',
      })
    }

    if (error instanceof TorBoxQueuedError) {
      return t({
        message:
          'Your streaming service is downloading all it can at once, so this waits its turn.',
        comment:
          'The streaming service queued a download until another finishes; do not name the service',
      })
    }

    if (error instanceof AbbSilentError) {
      return t({
        message:
          'AudioBookBay isn’t answering. It may have blocked your connection for a while; a proxy in Settings gets around it.',
        comment: 'Error when AudioBookBay stops answering, likely blocking the phone',
      })
    }

    if (error instanceof ProxyAuthError) {
      return t({
        message: 'The proxy did not accept its username and password. Check them in Settings.',
        comment: 'Error when the proxy rejects its sign-in',
      })
    }

    if (error instanceof NotStreamableError) {
      return t({
        message: 'This audiobook is not ready to play yet.',
        comment: 'Error when an audiobook has nothing to stream and is not on the phone',
      })
    }

    if (error instanceof PlaybackError) {
      return t({
        message: 'The audio could not be played. Try again.',
        comment: 'Error when the audio player fails to play a file',
      })
    }

    if (error instanceof ReadBudgetExceededError) {
      return t({
        message: 'The chapters of this audiobook could not be read.',
        comment: 'Error when reading chapter markers from the audio files fails',
      })
    }

    if (error instanceof BackupFormatError) {
      return t({
        message: 'This file is not a Vaka backup',
        comment: 'The picked file could not be read as a backup',
      })
    }

    if (error instanceof NetworkError) {
      return t({
        message: 'No connection. Check your internet and try again.',
        comment: 'Error when the phone could not connect at all',
      })
    }

    if (error instanceof TimeoutError) {
      return t({
        message: 'This took too long to answer. Try again in a moment.',
        comment: 'Error when a request timed out',
      })
    }

    if (error instanceof ZodError || error instanceof UnexpectedAnswerError) {
      return t({
        message: 'An unexpected answer came back. Try again later.',
        comment: 'Error when a site answered with something the app cannot read',
      })
    }

    if (error instanceof HttpError && error.status !== null) {
      if (error.status === 401 || error.status === 403) {
        return t({
          message: 'Access was refused. Check your keys in Settings.',
          comment: 'Error when a service refused the request, usually a key problem',
        })
      }

      if (error.status === 404) {
        return t({
          message: 'This could not be found.',
          comment: 'Error when a service answered that something does not exist',
        })
      }

      if (error.status === 429) {
        return t({
          message: 'Too many requests. Try again in a minute.',
          comment: 'Error when a service limited how often the app may ask',
        })
      }

      if (error.status >= 500) {
        return t({
          message: 'The service is having problems. Try again later.',
          comment: 'Error when a service failed on its side',
        })
      }
    }

    return (
      fallback ??
      t({
        message: 'Something went wrong. Try again.',
        comment: 'Error with no more specific wording',
      })
    )
  }
}
