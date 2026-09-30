import { useLingui } from '@lingui/react/macro'
import { HardcoverError } from '@/sources/hardcover/client'
import { isAuthenticationError } from '@/sources/torbox/client'
import { useErrorText } from '@/ui/errors'

/** What to tell the listener when a key they entered is not accepted. */
export function useKeyProblems() {
  const { t } = useLingui()
  const errorText = useErrorText()

  function torBox(error: Error) {
    return isAuthenticationError(error)
      ? t({ message: 'TorBox did not accept this API key', comment: 'TorBox key rejected' })
      : errorText(error)
  }

  function hardcover(error: Error) {
    const reason = error instanceof HardcoverError ? error.reason : 'other'

    switch (reason) {
      case 'rejectedKey':
        return t({
          message: 'Hardcover did not accept this API key',
          comment: 'Hardcover key rejected or expired',
        })
      case 'missingScope':
        return t({
          message: 'This key cannot read Hardcover’s catalogue. Create one with read:catalog.',
          comment: 'Hardcover key lacks the needed permission; read:catalog is a technical name',
        })
      case 'rateLimited':
        return t({
          message: 'Hardcover is busy. Try again in a minute.',
          comment: 'Hardcover rate limit reached',
        })
      case 'other':
        return errorText(error)
    }
  }

  return { torBox, hardcover }
}
