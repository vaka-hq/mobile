import { useLingui } from '@lingui/react/macro'
import { useIsFocused, useRouter } from 'expo-router'
import { useRef } from 'react'
import { useFeedback } from '@/lib/feedback'
import { type Ebook, type EbookResult, readyToRead, useEbooks } from '@/library/ebooks'
import { useDownloadEbook } from '@/library/queries'
import { useLabels } from '@/ui/labels'
import { BookRow, type CardPosition } from '@/ui/primitives'
import { useAskWhereToRead } from './place-prompt'

/** A file's format as sources show it, such as “EPUB”. */
export function ebookFormat(result: Pick<EbookResult, 'extension'>) {
  return (result.extension ?? 'epub').toUpperCase()
}

/**
 * A file as the book page names its source, in the order recordings are named: who made it,
 * its format and its size, as “Ray Porter · M4B · 128 Kbps” reads for a recording.
 */
export function ebookSource(result: Pick<EbookResult, 'publisher' | 'extension' | 'size'>) {
  // A size never breaks between its number and unit.
  const size = result.size?.replace(/ /gu, '\u00A0') ?? null

  return [result.publisher, ebookFormat(result), size].filter(Boolean).join(' · ')
}

/** What sets a file apart from the book's other files: language, year, size and publisher. */
export function ebookFacts(result: Pick<EbookResult, 'language' | 'year' | 'size' | 'publisher'>) {
  return [result.language, result.year, result.size, result.publisher].filter(Boolean).join(' · ')
}

/** Where a file on its way to the phone has got to, or null when it is not downloading. */
export function useEbookProgress() {
  const { t, i18n } = useLingui()

  return (ebook: Ebook | null) =>
    ebook?.status !== 'downloading'
      ? null
      : ebook.total > 0
        ? t({
            message: `Downloading · ${i18n.number(ebook.bytes / ebook.total, { style: 'percent' })}`,
            comment: 'E-book row while its file downloads, with how far it has got',
          })
        : t({ message: 'Downloading…', comment: 'E-book row while its file starts downloading' })
}

/** The message shown when an e-book's file could not be downloaded. */
export function useEbookDownloadFailed() {
  const { t } = useLingui()

  return t({
    message: 'The e-book could not be downloaded. Try another file.',
    comment: 'Shown when downloading an e-book failed',
  })
}

/**
 * One EPUB found for a book, with its details or, once it is on its way, how far it has got. The
 * screen decides what a tap does: open it to read, or make it the book's e-book.
 */
export function EbookResultRow({
  result,
  card,
  onPress,
}: {
  result: EbookResult
  /** The file the book is read in. */
  card?: CardPosition
  onPress: () => void
}) {
  const { t } = useLingui()
  const labels = useLabels()
  const progress = useEbookProgress()
  const ebook = useEbooks().get(result.md5) ?? null

  const detail =
    progress(ebook) ??
    (ebook?.kept && ebook.status === 'done'
      ? t({ message: 'Downloaded', comment: 'E-book row for a file already downloaded' })
      : ebook?.status === 'failed'
        ? t({
            message: 'Download failed · Tap to try again',
            comment: 'E-book row after its download failed',
          })
        : ebookFacts(result))

  return (
    <BookRow
      title={result.title}
      subtitle={result.authors.length > 0 ? labels.authors(result.authors) : null}
      detail={detail}
      coverUri={result.coverUrl}
      card={card}
      progress={
        ebook?.status === 'downloading' && ebook.total > 0 ? ebook.bytes / ebook.total : null
      }
      onPress={onPress}
    />
  )
}

/**
 * Opens a file to read: at once when it is on the phone, else once it has been fetched into the
 * cache, provided the screen it was tapped on is still showing.
 */
export function useOpenEbook() {
  const router = useRouter()
  const { showFeedback } = useFeedback()
  const failed = useEbookDownloadFailed()
  const ebooks = useEbooks()
  const download = useDownloadEbook()
  const focused = useIsFocused()
  const askWhereToRead = useAskWhereToRead()
  // Read when the download ends, so the reader only opens over the screen it was started from.
  const stillHere = useRef(focused)

  stillHere.current = focused

  function go(result: EbookResult, fromListening: boolean) {
    const path = {
      pathname: '/read/[md5]' as const,
      params: fromListening ? { md5: result.md5, from: 'listening' } : { md5: result.md5 },
    }

    if (readyToRead(result.md5)) {
      router.push(path)

      return
    }

    if (ebooks.get(result.md5)?.status === 'downloading') {
      return
    }

    download.mutate(result, {
      onSuccess: () => {
        // A download cancelled on the way, such as from the storage sheet, opens nothing.
        if ((stillHere.current || fromListening) && readyToRead(result.md5)) {
          router.push(path)
        }
      },
      onError: () => showFeedback(failed),
    })
  }

  /**
   * Opens a file to read. When the book was listened to more recently, the listener is first
   * asked where to read from. A switch from the player has settled that: with `fromListening` the
   * reader finds where listening stopped, and with `asked` it opens at the place prepared for it.
   */
  return (result: EbookResult, options: { fromListening?: boolean; asked?: boolean } = {}) => {
    if (options.fromListening || options.asked) {
      go(result, Boolean(options.fromListening))

      return
    }

    void askWhereToRead(result.md5, null).then((answer) => {
      if (answer) {
        go(result, answer.fromListening)
      }
    })
  }
}
