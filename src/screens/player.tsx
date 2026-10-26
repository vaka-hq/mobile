import { useLingui } from '@lingui/react/macro'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { BookmarksSheet, ChaptersSheet } from '@/components/book-sheets'
import { useOpenEbook } from '@/components/ebook-row'
import { findingTakesTime, findPlace, type PlaceWork } from '@/components/place-prompt'
import { fillMaxSize, fillMaxWidth, padding } from '@/lib/compose-modifiers'
import { Column, Row } from '@/lib/compose-ui'
import { displayAuthors, displayCoverArt, displayTitle } from '@/library/display'
import { type Ebook, ebookOfWork, ebookResultOf, useEbooks } from '@/library/ebooks'
import { prepareReadingPlace } from '@/library/listening-reading'
import { workIdOf } from '@/library/model'
import { useAddBookmark } from '@/library/queries'
import {
  close,
  pauseAndSave,
  play,
  seekBy,
  seekTo,
  skipChapter,
  togglePlay,
} from '@/player/controller'
import { collapsePlayer, fadeOutPlayer, playerCoverKey } from '@/player/expansion'
import { useNowPlaying } from '@/player/use-player'
import { usePreferences } from '@/settings/preferences'
import { TorBoxKeyMissingError } from '@/settings/torbox-key'
import { isAuthenticationError } from '@/sources/torbox/client'
import { useErrorText } from '@/ui/errors'
import { clock, speedLabel } from '@/ui/format'
import { useLabels } from '@/ui/labels'
import {
  ButtonGroup,
  Cover,
  Notice,
  PlayerFade,
  PlayPauseButton,
  SeekBar,
  SkipButton,
  ToneText,
} from '@/ui/primitives'
import { Action, ScreenFrame } from '@/ui/screen'
import { SleepSheet, SpeedSheet } from '@/ui/sheets'

/** Whether playback failed for want of an accepted key, which only Settings can fix. */
function keyError(error: Error) {
  return error instanceof TorBoxKeyMissingError || isAuthenticationError(error)
}

/** Seconds left on a time-based sleep timer, ticking once a second while it runs. */
function useCountdown(endsAt: number | null) {
  const [tick, setTick] = useState(() => ({ endsAt, now: Date.now() }))

  // A new timer restarts the clock during this render, so the first frame counts from now rather
  // than from whenever the last tick happened, which read a minute too many.
  if (tick.endsAt !== endsAt) {
    setTick({ endsAt, now: Date.now() })
  }

  useEffect(() => {
    if (endsAt === null) {
      return
    }

    const interval = setInterval(() => setTick({ endsAt, now: Date.now() }), 1000)

    return () => clearInterval(interval)
  }, [endsAt])

  return endsAt === null ? null : Math.max(0, (endsAt - tick.now) / 1000)
}

/**
 * The full player: the expanded side of the player layer, grown out of the mini player. It sits in
 * the layer's Compose tree rather than a route, so it uses the screen frame without its own Host.
 */
export function PlayerContent({ showsFeedback }: { showsFeedback: boolean }) {
  const { t } = useLingui()
  const errorText = useErrorText()
  const router = useRouter()
  const labels = useLabels()
  const { width, height: windowHeight } = useWindowDimensions()
  const preferences = usePreferences()
  const now = useNowPlaying()
  const [dragging, setDragging] = useState<number | null>(null)
  // The latest drag, read when it ends: the release can arrive before React has rendered the last
  // value, and the chapter it belongs to is fixed when the drag starts, even if playback moves on.
  const drag = useRef<{ value: number; track: number; start: number } | null>(null)
  const addBookmark = useAddBookmark(now?.book.id ?? '')
  const [sheet, setSheet] = useState<'speed' | 'sleep' | 'chapters' | 'bookmarks' | null>(null)
  const countdown = useCountdown(now?.sleep?.kind === 'time' ? now.sleep.endsAt : null)
  // The book's e-book, for switching to reading it from where listening stopped.
  const ebooks = useEbooks()
  const openEbook = useOpenEbook()
  const ebook = now ? ebookOfWork(ebooks, workIdOf(now.book)) : null

  /**
   * Switches to reading from where listening is: the audio pauses, the place is found in a dialog
   * over the player, which can cancel it, and only then does the reader open there.
   */
  async function readFromHere(target: Ebook) {
    await pauseAndSave()

    const workId = target.workId

    if (!workId || !target.sections || preferences.readingSync === 'off') {
      collapsePlayer()
      openEbook(ebookResultOf(target), { fromListening: preferences.readingSync !== 'off' })

      return
    }

    const work: PlaceWork = {
      busy: t({
        message: 'Finding the place…',
        comment: 'Shown while the place to pick the book up from is found',
      }),
      run: async (signal) => {
        await prepareReadingPlace(target, workId, signal)
      },
    }

    const found = findingTakesTime()
      ? await findPlace(t({ message: 'Switching to reading', comment: 'Dialog title' }), work)
      : await work.run(new AbortController().signal).then(
          () => true,
          () => false,
        )

    if (found) {
      collapsePlayer()
      openEbook(ebookResultOf(target), { asked: true })
    }
  }

  if (!now) {
    return null
  }

  const { book, summary } = now
  const chapter = book.chapters?.[summary.chapterIndex]
  const chapterStart = chapter && chapter.track === now.track ? chapter.start : 0
  const length = summary.chapterLength
  const elapsed = dragging ?? summary.chapterElapsed
  // Small enough on short screens that the whole player fits without scrolling.
  const coverSize = Math.min(width - 64, 320, windowHeight * 0.34)

  // Whole minutes left, rounded up, so the last minute reads "1 min" until the timer stops.
  const minutesLeft = countdown !== null ? Math.max(1, Math.ceil(countdown / 60)) : null

  const sleepText =
    now.sleep?.kind === 'chapter'
      ? t({
          message: 'Chapter',
          comment: 'Short sleep timer button label: stops at the end of this chapter',
        })
      : minutesLeft !== null
        ? t({
            message: `${minutesLeft} min`,
            comment: 'Sleep timer button: whole minutes left, like “5 min”',
          })
        : t({ message: 'Sleep', comment: 'Sleep timer chip when off' })

  // Spoken in full where the button shortens it.
  const sleepDescription =
    now.sleep?.kind === 'chapter'
      ? t({ message: 'End of chapter', comment: 'Sleep timer option' })
      : sleepText

  return (
    <ScreenFrame
      title=''
      navigation='collapse'
      onNavigate={collapsePlayer}
      showsFeedback={showsFeedback}
      // The player layer's background carries the colour, so it can blend into the bar's.
      transparent
      actions={
        <>
          {ebook ? (
            <Action
              glyph='read'
              label={t({
                message: 'Read from here',
                comment:
                  'Player button pausing the audiobook and opening its e-book at the same place',
              })}
              onPress={() => void readFromHere(ebook)}
            />
          ) : null}
          <Action
            glyph='clear'
            label={t({
              message: 'Stop and close',
              comment: 'Stops the audiobook and removes the player and its notification',
            })}
            // Fades out, then stops and closes.
            onPress={() => void fadeOutPlayer(close)}
          />
        </>
      }
    >
      <Column
        horizontalAlignment='center'
        // The cover and the controls share the height evenly, so the player sits centred.
        verticalArrangement='spaceEvenly'
        modifiers={[fillMaxSize(), padding(24, 0, 24, 8)]}
      >
        <Cover
          {...displayCoverArt(book)}
          dimension={coverSize}
          description={displayTitle(book)}
          sharedKey={playerCoverKey}
          viewable
        />
        {/* The cover and top bar travel with the opening player; the rest fades in after. */}
        <PlayerFade>
          <Column
            horizontalAlignment='center'
            verticalArrangement={{ spacedBy: 24 }}
            modifiers={[fillMaxWidth()]}
          >
            <Column
              horizontalAlignment='center'
              verticalArrangement={{ spacedBy: 4 }}
              modifiers={[fillMaxWidth()]}
            >
              <ToneText
                maxLines={2}
                overflow='ellipsis'
                style={{ typography: 'titleLarge', textAlign: 'center' }}
              >
                {displayTitle(book)}
              </ToneText>
              <ToneText
                tone='secondary'
                maxLines={1}
                overflow='ellipsis'
                style={{ textAlign: 'center' }}
              >
                {[labels.authors(displayAuthors(book)), book.hardcover?.releaseYear]
                  .filter(Boolean)
                  .join(' · ')}
              </ToneText>
              {summary.chapterCount > 1 ? (
                <ToneText
                  tone='accent'
                  maxLines={1}
                  overflow='ellipsis'
                  style={{ typography: 'titleSmall', textAlign: 'center' }}
                >
                  {labels.chapter(summary.chapterTitle, summary.chapterIndex)}
                </ToneText>
              ) : null}
            </Column>
            {now.error ? (
              // A missing or refused key is fixed in Settings; trying again would fail the same way.
              keyError(now.error) ? (
                <Notice
                  glyph='warning'
                  tone='error'
                  message={errorText(now.error)}
                  actionLabel={t({
                    message: 'Open settings',
                    comment: 'Opens the settings screen',
                  })}
                  onAction={() => {
                    collapsePlayer()
                    router.navigate('/settings')
                  }}
                />
              ) : (
                <Notice
                  glyph='warning'
                  tone='error'
                  message={errorText(now.error)}
                  actionLabel={t({ message: 'Retry', comment: 'Retries a failed action' })}
                  onAction={() => play()}
                />
              )
            ) : null}
            {/* The chapter's elapsed and remaining time, with the whole book's time left between. */}
            <SeekBar
              value={length ? Math.min(elapsed, length) : 0}
              max={length ?? 1}
              enabled={length !== null && length > 0}
              advancing={now.playing && !now.loading}
              rate={now.speed}
              start={clock(elapsed)}
              middle={
                summary.bookTotal !== null
                  ? labels.remaining((summary.bookTotal - summary.bookElapsed) / now.speed)
                  : null
              }
              end={length !== null ? `-${clock(length - elapsed)}` : '--:--'}
              onValueChange={(value) => {
                drag.current = {
                  value,
                  track: drag.current?.track ?? now.track,
                  start: drag.current?.start ?? chapterStart,
                }
                setDragging(value)
              }}
              onValueChangeFinished={() => {
                const released = drag.current

                drag.current = null
                setDragging(null)

                if (released) {
                  void seekTo(released.track, released.start + released.value)
                }
              }}
            />
            <Row
              verticalAlignment='center'
              horizontalArrangement='spaceEvenly'
              modifiers={[fillMaxWidth()]}
            >
              <Action
                glyph='previousChapter'
                dimension={28}
                label={t({ message: 'Previous chapter', comment: 'Player control' })}
                enabled={summary.chapterCount > 1}
                onPress={() => void skipChapter(-1)}
              />
              <SkipButton
                direction='back'
                seconds={preferences.skipBackSeconds}
                description={t({
                  message: `Back ${preferences.skipBackSeconds} seconds`,
                  comment: 'Player control jumping backwards',
                })}
                onPress={() => void seekBy(-preferences.skipBackSeconds)}
              />
              <PlayPauseButton
                playing={now.playing || now.loading}
                buffering={now.loading}
                dimension={80}
                filled
                playLabel={t({ message: 'Play', comment: 'Plays the audiobook' })}
                pauseLabel={t({ message: 'Pause', comment: 'Pauses the audiobook' })}
                onPress={togglePlay}
              />
              <SkipButton
                direction='forward'
                seconds={preferences.skipForwardSeconds}
                description={t({
                  message: `Forward ${preferences.skipForwardSeconds} seconds`,
                  comment: 'Player control jumping forwards',
                })}
                onPress={() => void seekBy(preferences.skipForwardSeconds)}
              />
              <Action
                glyph='nextChapter'
                dimension={28}
                label={t({ message: 'Next chapter', comment: 'Player control' })}
                enabled={summary.chapterIndex < summary.chapterCount - 1}
                onPress={() => void skipChapter(1)}
              />
            </Row>
            <ButtonGroup
              buttons={[
                ...(summary.chapterCount > 1
                  ? [
                      {
                        key: 'chapters',
                        glyph: 'chapters' as const,
                        label: t({ message: 'Chapters', comment: 'Opens the chapter list' }),
                        onPress: () => setSheet('chapters'),
                      },
                    ]
                  : []),
                {
                  key: 'bookmarks',
                  glyph: 'bookmarks',
                  label: t({ message: 'Bookmarks', comment: 'Opens the bookmark list' }),
                  onPress: () => setSheet('bookmarks'),
                  // Holding adds one where the listener is, without opening the list.
                  onLongPress: () =>
                    addBookmark.mutate({ track: now.track, position: now.position }),
                },
                {
                  key: 'sleep',
                  glyph: 'sleep',
                  label: sleepText,
                  description:
                    now.sleep === null
                      ? t({
                          message: 'Sleep timer, off',
                          comment: 'Player button opening the sleep timer while it is off',
                        })
                      : t({
                          message: `Sleep timer, ${sleepDescription}`,
                          comment:
                            'Player button opening the sleep timer, with the time left or “End of chapter”',
                        }),
                  selected: now.sleep !== null,
                  onPress: () => setSheet('sleep'),
                },
                {
                  key: 'speed',
                  glyph: 'speed',
                  label: speedLabel(now.speed),
                  description: t({
                    message: `Playback speed ${speedLabel(now.speed)}`,
                    comment: 'Player button opening the speed choice, with the current speed',
                  }),
                  selected: now.speed !== 1,
                  onPress: () => setSheet('speed'),
                },
              ]}
            />
          </Column>
        </PlayerFade>
      </Column>
      {sheet === 'chapters' ? (
        <ChaptersSheet bookId={book.id} onDismiss={() => setSheet(null)} />
      ) : null}
      {sheet === 'bookmarks' ? (
        <BookmarksSheet bookId={book.id} onDismiss={() => setSheet(null)} />
      ) : null}
      {sheet === 'speed' ? <SpeedSheet speed={now.speed} onDismiss={() => setSheet(null)} /> : null}
      {sheet === 'sleep' ? (
        <SleepSheet
          sleep={now.sleep}
          hasChapters={summary.chapterCount > 1}
          onDismiss={() => setSheet(null)}
        />
      ) : null}
    </ScreenFrame>
  )
}
