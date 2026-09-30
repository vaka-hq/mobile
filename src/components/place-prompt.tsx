import { useLingui } from '@lingui/react/macro'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Host } from '@/components/host'
import { AbortedError } from '@/lib/abort'
import { useFeedback } from '@/lib/feedback'
import { getEbook } from '@/library/ebooks'
import {
  listeningPlaceFromEbook,
  newerListening,
  newerReading,
  prepareReadingPlace,
} from '@/library/listening-reading'
import { workIdOf } from '@/library/model'
import { bookDuration } from '@/library/timeline'
import { getState, pauseAndSave, setPlayGate } from '@/player/controller'
import { getPreferences } from '@/settings/preferences'
import { FindingPlaceDialog, PlaceChoiceDialog, type PlaceOption } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { useLabels } from '@/ui/labels'

/**
 * Asking where to pick a book up, and finding that place, over the screen the listener is on,
 * before the reader or the player opens. One dialog at a time: a choice between where this way of
 * following the book left off and where the other did, or, for a switch, only the finding. Either
 * can be cancelled at any time, and then nothing opens.
 */

export type WhereToStart = 'stay' | 'move'

type Choice = Omit<PlaceOption, 'onPress'>

/** Finding a place, said while it runs; it stops when `signal` is aborted. */
export type PlaceWork = { busy: string; run: (signal: AbortSignal) => Promise<void> }

type Question =
  | {
      kind: 'choice'
      title: string
      stay: Choice
      move: Choice
      /** Finding the place moved to, done in the dialog once moving is chosen. */
      moving?: PlaceWork
      answer: (choice: WhereToStart | null) => void
    }
  | { kind: 'work'; title: string; work: PlaceWork; answer: (done: boolean) => void }

let question: Question | null = null

const listeners = new Set<() => void>()

function set(next: Question | null) {
  question = next

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

/** Closes whatever is being asked, as if cancelled, before something else is. */
function cancelOpen() {
  if (question?.kind === 'choice') {
    question.answer(null)
  } else if (question?.kind === 'work') {
    question.answer(false)
  }
}

/**
 * Asks where to start; resolves `move` only once the place moved to is found, and null when the
 * listener cancelled, whether choosing or while it was being found.
 */
export function askWhereToStart(ask: {
  title: string
  stay: Choice
  move: Choice
  moving?: PlaceWork
}) {
  cancelOpen()

  return new Promise<WhereToStart | null>((resolve) => {
    set({
      kind: 'choice',
      ...ask,
      answer: (choice) => {
        set(null)
        resolve(choice)
      },
    })
  })
}

/** Finds a place in a dialog of its own; resolves false when the listener cancelled. */
export function findPlace(title: string, work: PlaceWork) {
  cancelOpen()

  return new Promise<boolean>((resolve) => {
    set({
      kind: 'work',
      title,
      work,
      answer: (done) => {
        set(null)
        resolve(done)
      },
    })
  })
}

/** Whether finding a place takes long enough to say so: hearing the words does. */
export function findingTakesTime() {
  return getPreferences().readingSync === 'words'
}

/**
 * Asks, before the reader opens, whether to read on from where reading stopped or from where the
 * book was last listened to, when that is more recent and elsewhere. Moving finds the place in the
 * dialog first. Resolves how to open the reader: `prepared` when the reader opens at a place found
 * here, `fromListening` when it must find it itself, as for an e-book never opened; null when the
 * listener cancelled.
 */
export function useAskWhereToRead() {
  const { t } = useLingui()
  const labels = useLabels()

  return async (
    md5: string,
    workId: string | null,
  ): Promise<{ prepared: boolean; fromListening: boolean } | null> => {
    const ebook = getEbook(md5)
    const book = workId ?? ebook?.workId ?? null
    const player = getState()

    // Reading the book being listened to pauses it at once, which also saves where listening
    // stopped, so the question below compares with that place.
    if (
      book &&
      player.book &&
      workIdOf(player.book) === book &&
      (player.playing || player.loading)
    ) {
      await pauseAndSave().catch(() => undefined)
    }

    const heard = book ? await newerListening(book, ebook ?? null).catch(() => null) : null

    if (!book || !heard) {
      return { prepared: false, fromListening: false }
    }

    const read = ebook?.lastReadAt !== null && ebook?.lastReadAt !== undefined
    let prepared = false

    const choice = await askWhereToStart({
      title: t({
        message: 'Continue from',
        comment: 'Title of the dialog asking where to pick a book up, before reading or listening',
      }),
      stay: {
        glyph: 'read',
        label: read
          ? t({
              message: 'Last read',
              comment: 'Choice picking the book up where reading stopped; the chapter follows',
            })
          : t({
              message: 'Beginning',
              comment: 'Choice opening an e-book not read before at its start',
            }),
        detail: read && ebook ? labels.readingPlace(ebook) : null,
      },
      move: {
        glyph: 'listen',
        label: t({
          message: 'Last listened',
          comment: 'Choice picking the book up where listening stopped; the chapter follows',
        }),
        detail: labels.listeningPlace(heard.seconds, heard.total),
      },
      moving: ebook
        ? {
            busy: t({
              message: 'Finding the place…',
              comment: 'Shown while the place to pick the book up from is found',
            }),
            run: async (signal) => {
              prepared = await prepareReadingPlace(ebook, book, signal)
            },
          }
        : undefined,
    })

    return choice === null
      ? null
      : {
          prepared: choice === 'move' && prepared,
          fromListening: choice === 'move' && !prepared,
        }
  }
}

/**
 * Shows the question or the finding, and asks before playback starts after the book was read
 * further on: then whether to listen on from where listening stopped or from where reading did.
 */
export function PlacePrompt() {
  const { t } = useLingui()
  const labels = useLabels()
  const errorText = useErrorText()
  const { showFeedback } = useFeedback()
  const current = useSyncExternalStore(subscribe, (): Question | null => question)
  const [busy, setBusy] = useState(false)
  const running = useRef<AbortController | null>(null)

  useEffect(() => {
    setPlayGate(async (book, listening) => {
      const reading = newerReading(book, listening.listenedAt, listening.seconds)

      if (!reading) {
        return true
      }

      // Found in the dialog, and handed back so the book opens, or moves, there.
      let target: { track: number; position: number } | null = null

      const choice = await askWhereToStart({
        title: t({
          message: 'Continue from',
          comment:
            'Title of the dialog asking where to pick a book up, before reading or listening',
        }),
        stay: {
          glyph: 'listen',
          label: t({
            message: 'Last listened',
            comment: 'Choice picking the book up where listening stopped; the chapter follows',
          }),
          detail:
            listening.seconds === null
              ? null
              : labels.listeningPlace(listening.seconds, bookDuration(book.durations)),
        },
        move: {
          glyph: 'read',
          label: t({
            message: 'Last read',
            comment: 'Choice picking the book up where reading stopped; the chapter follows',
          }),
          detail: labels.readingPlace(reading.ebook),
        },
        moving: {
          busy: t({
            message: 'Finding the place…',
            comment: 'Shown while the place to pick the book up from is found',
          }),
          run: async (signal) => {
            target = await listeningPlaceFromEbook(book, reading.ebook, signal)
          },
        },
      })

      const found: { track: number; position: number } | null = target

      return choice === null ? false : choice === 'move' && found ? found : true
    })

    return () => setPlayGate(null)
  }, [t, labels])

  /** Runs `work`, answering once it is done; cancelling stops it and answers at once. */
  async function run(work: PlaceWork, done: (found: boolean) => void) {
    const controller = new AbortController()

    running.current = controller
    setBusy(true)

    try {
      await work.run(controller.signal)

      if (!controller.signal.aborted) {
        done(true)
      }
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof AbortedError)) {
        showFeedback(errorText(error instanceof Error ? error : null))
        done(false)
      }
    } finally {
      if (running.current === controller) {
        running.current = null
        setBusy(false)
      }
    }
  }

  // A switch's finding starts as soon as its dialog shows.
  const started = useRef<Question | null>(null)

  useEffect(() => {
    if (current?.kind === 'work' && started.current !== current) {
      started.current = current
      void run(current.work, current.answer)
    }
  })

  function cancel(answer: () => void) {
    running.current?.abort()
    running.current = null
    setBusy(false)
    answer()
  }

  if (!current) {
    return null
  }

  const asked = current

  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      {asked.kind === 'choice' ? (
        <PlaceChoiceDialog
          title={asked.title}
          options={[
            { ...asked.stay, onPress: () => asked.answer('stay') },
            {
              ...asked.move,
              onPress: () => {
                const moving = asked.moving

                if (moving) {
                  void run(moving, (found) => asked.answer(found ? 'move' : null))
                } else {
                  asked.answer('move')
                }
              },
            },
          ]}
          busy={busy ? (asked.moving?.busy ?? null) : null}
          onDismiss={() => cancel(() => asked.answer(null))}
        />
      ) : (
        <FindingPlaceDialog
          title={asked.title}
          message={asked.work.busy}
          onCancel={() => cancel(() => asked.answer(false))}
        />
      )}
    </Host>
  )
}
