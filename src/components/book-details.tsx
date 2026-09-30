import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { type ReactNode, useEffect, useRef } from 'react'
import { useWindowDimensions } from 'react-native'
import { useCancelDownloadPrompt } from '@/components/cancel-download'
import { useDownloadGuard } from '@/components/download-guard'
import { animateContentSize, fillMaxWidth, padding, size, weight } from '@/lib/compose-modifiers'
import {
  AnimatedVisibility,
  Box,
  Button,
  CircularProgressIndicator,
  Column,
  EnterTransition,
  ExitTransition,
  Icon,
  LinearProgressIndicator,
  Row,
  Text,
  useMaterialColors,
} from '@/lib/compose-ui'
import { useFeedback } from '@/lib/feedback'
import type { TorBoxStatus } from '@/library/books'
import { type BookRecord, workIdOf } from '@/library/model'
import { useOfflineBooks } from '@/library/offline'
import { useStartListening, useSwitchStream, useTorBoxStatus } from '@/library/queries'
import { bookDuration } from '@/library/timeline'
import { togglePlay } from '@/player/controller'
import { beginStarting, endStarting, fadeInPlayer } from '@/player/expansion'
import { usePlayerValue } from '@/player/use-player'
import { useTorBoxKey } from '@/settings/torbox-key'
import type { HardcoverBook } from '@/sources/hardcover/client'
import { useErrorText } from '@/ui/errors'
import { glyphs } from '@/ui/glyphs'
import { useLabels } from '@/ui/labels'
import { Cover, type CoverArt, Group, type GroupRow, type SpringAction } from '@/ui/primitives'

export type BookHeaderProps = {
  title: string
  subtitle: string | null
  authors: string[]
  narrators: string[]
  series: { name: string; position: number | null } | null
  /** When the book came out, shown after the authors, such as “Andy Weir · 2011”. */
  released?: string | null
  cover: CoverArt
  /** Inside `FitToScreen`, the cover takes the height the page has left. */
  fitted?: boolean
}

/** The full-width cover above the title block; details that arrive later ease the text into size. */
export function BookHeader({
  title,
  subtitle,
  authors,
  narrators,
  series,
  released,
  cover,
  fitted = false,
}: BookHeaderProps) {
  const { t } = useLingui()
  const colors = useMaterialColors()
  const labels = useLabels()
  const { width } = useWindowDimensions()

  // A whole cast is cut to its first few names, so the credits stay a line or two.
  const narratedBy = labels.fewNames(narrators, 3)

  // Title and subtitle read as one unit, with the credits right beneath them.
  const credits = (
    <Column modifiers={[fillMaxWidth(), animateContentSize()]}>
      <Column verticalArrangement={{ spacedBy: 2 }}>
        <Text style={{ typography: 'headlineMedium' }}>{title}</Text>
        {subtitle ? (
          <Text color={colors.onSurfaceVariant} style={{ typography: 'titleMedium' }}>
            {subtitle}
          </Text>
        ) : null}
      </Column>
      <Column verticalArrangement={{ spacedBy: 2 }}>
        {authors.length > 0 || released ? (
          <Text color={colors.primary} style={{ typography: 'titleMedium' }}>
            {[authors.length > 0 ? labels.authors(authors) : null, released]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        {narrators.length > 0 ? (
          <Text color={colors.onSurfaceVariant} style={{ typography: 'bodyMedium' }}>
            {t({
              message: `Narrated by ${narratedBy}`,
              comment: 'Narrator credit under the author on the book page',
            })}
          </Text>
        ) : null}
        {series ? (
          <Text color={colors.onSurfaceVariant} style={{ typography: 'bodyMedium' }}>
            {series.position !== null
              ? t({
                  message: `Book ${series.position} of ${series.name}`,
                  comment: 'Position in a book series, for example “Book 2 of The Expanse”',
                })
              : series.name}
          </Text>
        ) : null}
      </Column>
    </Column>
  )

  // Fitted, the cover and the credits are separate children of `FitToScreen`, which gives the
  // cover the height the page has left; otherwise the cover is as wide as the page.
  return fitted ? (
    <>
      <Cover {...cover} dimension={160} fill description={title} />
      {credits}
    </>
  ) : (
    <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 20 }}>
      <Cover {...cover} dimension={width - 32} description={title} />
      {credits}
    </Column>
  )
}

/**
 * Says so when a download the listener is watching finishes, since the button only changes its
 * label; many downloads finish within a minute.
 */
function useReadyNotice(kind: TorBoxStatus['kind'] | undefined) {
  const { t } = useLingui()
  const { showFeedback } = useFeedback()
  const previous = useRef(kind)

  useEffect(() => {
    if (previous.current === 'downloading' && kind === 'ready') {
      showFeedback(
        t({ message: 'Downloaded and ready to listen.', comment: 'A download has just finished' }),
      )
    }

    previous.current = kind
  }, [kind, showFeedback, t])
}

function useStatusMessage(status: TorBoxStatus | undefined) {
  const { t } = useLingui()

  switch (status?.kind) {
    case 'ready':
      return t({ message: 'Ready to stream', comment: 'Book status: playable now' })
    case 'cached':
      return t({
        message: 'Ready. Streaming starts right away.',
        comment: 'Book status: TorBox already has the files',
      })
    case 'notCached':
      return t({
        message: 'Not ready yet. It downloads first, which can take a while.',
        comment: 'Book status: TorBox must download the torrent',
      })
    case 'downloading': {
      const percent = Math.round(status.progress * 100)

      return status.stalled
        ? t({
            message: `Stalled at ${percent}%. No one may be sharing it right now.`,
            comment: 'Book status: the download stopped getting anywhere, with its progress',
          })
        : t({
            message: `Downloading · ${percent}%`,
            comment: 'Book status with download progress',
          })
    }

    case 'noAudio':
      return t({
        message: 'This torrent has no .m4b, .m4a or .mp3 files to play.',
        comment: 'Book status: nothing streamable',
      })
    case undefined:
      return t({ message: 'Checking…', comment: 'Book status while checking availability' })
  }
}

export type ListenPanelProps = {
  /** The stream to play; null while a book's streams are still being found. */
  book: BookRecord | null
  /** Shown instead of the TorBox status while there is no stream. */
  waitingMessage?: string
  /** Runs before listening starts, such as remembering the stream for its book. */
  beforeListen?: () => Promise<void>
}

/**
 * The listen area keeps one layout from the first frame: a status line and a full-width button
 * whose text and state change in place, so checking TorBox never pushes the page around.
 */
export function ListenPanel({ book, waitingMessage, beforeListen }: ListenPanelProps) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const colors = useMaterialColors()
  const { showFeedback } = useFeedback()
  const apiKey = useTorBoxKey()

  // Which book the player holds and whether it plays, not its position, which ticks constantly.
  const player = {
    book: usePlayerValue((state) => state.book),
    playing: usePlayerValue((state) => state.playing),
  }

  const status = useTorBoxStatus(book ?? undefined)
  const start = useStartListening(book?.id ?? '')
  const cancelPrompt = useCancelDownloadPrompt()
  const downloadGuard = useDownloadGuard()
  const current = book !== null && player.book?.id === book.id
  const statusText = useStatusMessage(status.data)
  const kind = status.data?.kind
  // A book kept on the phone plays whatever TorBox answers, or if it cannot be reached.
  const onPhone = useOfflineBooks().get(book?.id ?? '')?.status === 'done'

  useReadyNotice(kind)
  const waiting = book === null
  const checking = !waiting && Boolean(apiKey) && status.isPending && !status.error

  function listen() {
    // The book already in the mini player just plays or pauses here; the full player stays shut.
    if (current) {
      togglePlay()

      return
    }

    void (async () => {
      try {
        await beforeListen?.()
      } catch (error) {
        showFeedback(errorText(error instanceof Error ? error : null))

        return
      }

      // An upload TorBox lacks is downloaded, which may replace a download in progress.
      void downloadGuard.guard(kind === 'notCached' && !onPhone, book?.abb.infoHash ?? '', () => {
        // The player stays out of sight while the book loads and the listener may be asked where
        // to start; playing, it fades in open, otherwise the mini player shows as it was.
        beginStarting()
        start.mutate(undefined, {
          onSuccess: (result) => {
            if (result === 'playing') {
              fadeInPlayer()
            } else if (result === 'downloading') {
              showFeedback(
                t({
                  message: 'Downloading. You can listen once it has finished.',
                  comment: 'Feedback after adding an uncached audiobook',
                }),
              )
            }
          },
          onError: (error) => showFeedback(errorText(error)),
          onSettled: (result) => {
            if (result !== 'playing') {
              endStarting()
            }
          },
        })
      })
    })()
  }

  const message = !apiKey
    ? t({
        message: 'Add your streaming API key in Settings to stream audiobooks.',
        comment:
          'Book page notice when the streaming service key is not set; do not name the service',
      })
    : waiting
      ? (waitingMessage ?? '')
      : status.error
        ? errorText(status.error)
        : statusText

  const glyph = !apiKey
    ? 'key'
    : status.error || kind === 'noAudio'
      ? 'warning'
      : kind === 'ready' || kind === 'cached'
        ? 'cached'
        : 'download'

  const action = !apiKey
    ? {
        glyph: 'settings' as const,
        label: t({ message: 'Open settings', comment: 'Opens the settings screen' }),
        enabled: true,
        run: () => router.navigate('/settings'),
      }
    : status.error && !waiting && !onPhone
      ? {
          glyph: 'refresh' as const,
          label: t({ message: 'Retry', comment: 'Retries a failed action' }),
          enabled: true,
          run: () => void status.refetch(),
        }
      : kind === 'downloading' && book && !current
        ? {
            glyph: 'clear' as const,
            label: t({ message: 'Cancel download', comment: 'Stops a TorBox download' }),
            enabled: !cancelPrompt.cancelling,
            run: () => cancelPrompt.ask(book.id),
          }
        : kind === 'notCached' && !current
          ? {
              glyph: 'download' as const,
              label:
                start.isPending || downloadGuard.checking
                  ? t({ message: 'Adding…', comment: 'Button while adding to TorBox' })
                  : t({
                      message: 'Download',
                      comment: 'Listen button for a source TorBox must download',
                    }),
              enabled: !start.isPending && !downloadGuard.checking,
              run: listen,
            }
          : {
              glyph: current && player.playing ? ('pause' as const) : ('play' as const),
              label: start.isPending
                ? t({
                    message: 'Preparing…',
                    comment: 'Play button while TorBox prepares the stream',
                  })
                : current && player.playing
                  ? t({
                      message: 'Pause',
                      comment: 'Listen button pausing the book that is playing',
                    })
                  : current || book?.lastPlayedAt
                    ? t({
                        message: 'Resume',
                        comment: 'Continue listening from the saved position',
                      })
                    : t({ message: 'Listen', comment: 'Starts streaming the audiobook' }),
              enabled:
                !waiting &&
                !start.isPending &&
                (current || onPhone || kind === 'ready' || kind === 'cached'),
              run: listen,
            }

  return (
    <Column
      modifiers={[fillMaxWidth(), animateContentSize()]}
      verticalArrangement={{ spacedBy: 12 }}
    >
      <Row verticalAlignment='center' horizontalArrangement={{ spacedBy: 12 }}>
        <Box contentAlignment='center' modifiers={[size(24, 24)]}>
          {checking || (waiting && apiKey) ? (
            <CircularProgressIndicator strokeWidth={2} modifiers={[size(18, 18)]} />
          ) : (
            <Icon
              source={glyphs[glyph]}
              size={20}
              tint={glyph === 'warning' ? colors.error : colors.onSurfaceVariant}
            />
          )}
        </Box>
        <Text
          color={colors.onSurfaceVariant}
          style={{ typography: 'bodyMedium' }}
          modifiers={[weight(1)]}
        >
          {message}
        </Text>
      </Row>
      <AnimatedVisibility
        visible={kind === 'downloading'}
        enterTransition={EnterTransition.fadeIn().plus(EnterTransition.expandVertically())}
        exitTransition={ExitTransition.fadeOut().plus(ExitTransition.shrinkVertically())}
      >
        <LinearProgressIndicator
          progress={status.data?.kind === 'downloading' ? status.data.progress : 0}
          modifiers={[fillMaxWidth()]}
        />
      </AnimatedVisibility>
      <Button onClick={action.run} enabled={action.enabled} modifiers={[fillMaxWidth()]}>
        <Icon source={glyphs[action.glyph]} size={20} />
        <Text modifiers={[padding(8, 0, 0, 0)]}>{action.label}</Text>
      </Button>
      {cancelPrompt.dialog}
      {downloadGuard.dialog}
    </Column>
  )
}

/**
 * The Listen button for a book page: what it says and does for the chosen stream. TorBox's state
 * lives in the label (downloading, preparing) rather than as a status line, and a stream TorBox
 * lacks is added on the first press. Without a stream it stays a disabled Listen; the source row
 * beside it says why. While another source of the same book plays, it offers to switch to the
 * chosen one; while TorBox downloads the chosen one, it offers to cancel. `dialog` goes in the
 * screen's tree for that question.
 */
export function useListenAction({
  book,
  listened,
  beforeListen,
}: {
  book: BookRecord | null
  /**
   * Whether the button resumes, when the page decides, such as only when listening was the last
   * way the book was followed; otherwise it resumes once this recording was played.
   */
  listened?: boolean
  beforeListen?: () => Promise<void>
}): SpringAction & { dialog: ReactNode } {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const { showFeedback } = useFeedback()
  const apiKey = useTorBoxKey()

  // Which book the player holds and whether it plays, not its position, which ticks constantly.
  const player = {
    book: usePlayerValue((state) => state.book),
    playing: usePlayerValue((state) => state.playing),
  }

  const status = useTorBoxStatus(book ?? undefined)
  const start = useStartListening(book?.id ?? '')
  const cancelPrompt = useCancelDownloadPrompt()
  const downloadGuard = useDownloadGuard()
  const current = book !== null && player.book?.id === book.id

  const onPhone = useOfflineBooks().get(book?.id ?? '')?.status === 'done'

  // The book is playing, but from another source than the one now chosen.
  const otherSource =
    book !== null && player.book !== null && !current && workIdOf(player.book) === workIdOf(book)

  const kind = status.data?.kind

  useReadyNotice(kind)

  const switchSource = useSwitchStream((switched, error) => {
    if (error) {
      showFeedback(errorText(error))
    } else if (!switched) {
      showFeedback(
        t({
          message: 'Downloading. You can change to it once it has finished.',
          comment: 'Feedback after switching to an uncached source of the book that is playing',
        }),
      )
    }
  })

  const action = listenAction()

  return {
    ...action,
    dialog: (
      <>
        {cancelPrompt.dialog}
        {downloadGuard.dialog}
      </>
    ),
  }

  function listen() {
    // The book already in the mini player just plays or pauses here; the full player stays shut.
    if (current) {
      togglePlay()

      return
    }

    void (async () => {
      try {
        await beforeListen?.()
      } catch (error) {
        showFeedback(errorText(error instanceof Error ? error : null))

        return
      }

      // An upload TorBox lacks is downloaded, which may replace a download in progress.
      void downloadGuard.guard(kind === 'notCached' && !onPhone, book?.abb.infoHash ?? '', () => {
        // The player stays out of sight while the book loads and the listener may be asked where
        // to start; playing, it fades in open, otherwise the mini player shows as it was.
        beginStarting()
        start.mutate(undefined, {
          onSuccess: (result) => {
            if (result === 'playing') {
              fadeInPlayer()
            } else if (result === 'downloading') {
              showFeedback(
                t({
                  message: 'Downloading. You can listen once it has finished.',
                  comment: 'Feedback after adding an uncached audiobook',
                }),
              )
            }
          },
          onError: (error) => showFeedback(errorText(error)),
          onSettled: (result) => {
            if (result !== 'playing') {
              endStarting()
            }
          },
        })
      })
    })()
  }

  function listenAction(): SpringAction {
    if (!apiKey) {
      return {
        glyph: 'key',
        label: t({
          message: 'Add streaming key',
          comment:
            'Listen button without the streaming service’s API key; it opens Settings. Do not name the service',
        }),
        onPress: () => router.navigate('/settings'),
      }
    }

    if (!book) {
      return {
        glyph: 'play',
        label: t({ message: 'Listen', comment: 'Starts streaming the audiobook' }),
        enabled: false,
        onPress: () => undefined,
      }
    }

    if (
      start.isPending ||
      switchSource.isPending ||
      cancelPrompt.cancelling ||
      downloadGuard.checking
    ) {
      return {
        glyph: 'play',
        label: t({
          message: 'Preparing…',
          comment: 'Play button while TorBox prepares the stream',
        }),
        enabled: false,
        onPress: () => undefined,
      }
    }

    // A check that failed says so, rather than showing the last progress it had as if current.
    if (!current && !onPhone && status.isError) {
      return {
        glyph: 'refresh',
        label: t({
          message: 'Check again',
          comment: 'Listen button when checking the download failed; pressing it checks again',
        }),
        onPress: () => void status.refetch(),
      }
    }

    if (!current && !onPhone && status.data?.kind === 'downloading') {
      const percent = Math.round(status.data.progress * 100)
      const bookId = book.id

      // The progress is the label; pressing offers to cancel, as the cross says.
      return {
        glyph: 'clear',
        label: status.data.stalled
          ? t({
              message: `Stalled · ${percent}%`,
              comment:
                'Listen button while the download has stopped getting anywhere; pressing it offers to cancel',
            })
          : t({
              message: `Downloading · ${percent}%`,
              comment:
                'Listen button while TorBox downloads the audiobook; pressing it offers to cancel',
            }),
        onPress: () => cancelPrompt.ask(bookId),
      }
    }

    if (!current && kind === 'noAudio') {
      return {
        glyph: 'warning',
        label: t({ message: 'Not playable', comment: 'Listen button for a torrent without audio' }),
        enabled: false,
        onPress: () => undefined,
      }
    }

    if (otherSource) {
      const bookId = book.id

      return {
        glyph: 'changeSource',
        label: t({
          message: 'Change source',
          comment: 'Listen button when another source of the book is playing',
        }),
        onPress: () =>
          void downloadGuard.guard(kind === 'notCached' && !onPhone, book?.abb.infoHash ?? '', () =>
            switchSource.mutate(bookId),
          ),
      }
    }

    // TorBox lacks it, so pressing starts a download rather than playback.
    if (!current && !onPhone && kind === 'notCached') {
      return {
        glyph: 'download',
        label: t({
          message: 'Download',
          comment: 'Listen button for a source TorBox must download',
        }),
        onPress: listen,
      }
    }

    return {
      glyph: current && player.playing ? 'pause' : 'play',
      label:
        current && player.playing
          ? t({ message: 'Pause', comment: 'Listen button pausing the book that is playing' })
          : // When the page decides, even the book in the mini player resumes only after listening
            // was the last way it was followed.
            (listened ?? (current || Boolean(book.lastPlayedAt)))
            ? t({ message: 'Resume', comment: 'Continue listening from the saved position' })
            : t({ message: 'Listen', comment: 'Starts streaming the audiobook' }),
      onPress: listen,
    }
  }
}

/**
 * Facts about the stream being listened to: its measured length and chapters, the Hardcover
 * edition of that recording, and the upload's format and size.
 */
export function StreamFacts({
  book,
  hardcover,
  extraRows = [],
}: {
  book: BookRecord
  hardcover: HardcoverBook | null
  extraRows?: GroupRow[]
}) {
  const { t } = useLingui()
  const labels = useLabels()
  const edition = hardcover?.edition
  const duration = bookDuration(book.durations) ?? edition?.durationSeconds ?? null
  const chapters = book.chapters?.length ?? 0

  const release =
    edition?.releaseDate ?? (hardcover?.releaseYear ? String(hardcover.releaseYear) : null)

  const language = edition?.language ?? book.abb.language

  const facts = [
    duration !== null
      ? {
          label: t({ message: 'Length', comment: 'Book fact label' }),
          value: labels.duration(duration),
        }
      : null,
    chapters > 1
      ? { label: t({ message: 'Chapters', comment: 'Book fact label' }), value: String(chapters) }
      : null,
    edition?.publisher
      ? { label: t({ message: 'Publisher', comment: 'Book fact label' }), value: edition.publisher }
      : null,
    release
      ? { label: t({ message: 'Released', comment: 'Book fact label' }), value: release }
      : null,
    language
      ? { label: t({ message: 'Language', comment: 'Book fact label' }), value: language }
      : null,
    book.abb.format
      ? {
          label: t({ message: 'Format', comment: 'Book fact label' }),
          value: [
            book.abb.format,
            book.abb.bitrate,
            book.abb.abridged === true
              ? t({ message: 'Abridged', comment: 'Edition is shortened' })
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : null,
    book.abb.totalSize
      ? { label: t({ message: 'Size', comment: 'Book fact label' }), value: book.abb.totalSize }
      : null,
    book.abb.categories.length > 0
      ? {
          label: t({ message: 'Categories', comment: 'Book fact label' }),
          value: book.abb.categories.join(', '),
        }
      : null,
  ]

  const rows: GroupRow[] = []

  for (const fact of facts) {
    if (fact) {
      rows.push({ key: fact.label, label: fact.label, value: fact.value })
    }
  }

  return (
    <Group
      title={t({ message: 'Details', comment: 'Book facts heading' })}
      rows={[...rows, ...extraRows]}
    />
  )
}
