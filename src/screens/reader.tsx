import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { BackHandler, Share, useWindowDimensions, View } from 'react-native'
import { cancelAnimation, Easing, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Host } from '@/components/host'
import { findingTakesTime, findPlace, type PlaceWork } from '@/components/place-prompt'
import {
  BookSearchPage,
  ContentsSheet,
  DisplayPanel,
  HighlightSheet,
  NotesSheet,
  type SearchHit,
} from '@/components/reader-sheets'
import {
  type ReaderEvent,
  type ReaderStyle,
  ReaderView,
  type ReaderViewHandle,
  type TocItem,
} from '@/components/reader-view'
import { useAppColorScheme } from '@/lib/app-color-scheme'
import { useFeedback } from '@/lib/feedback'
import {
  downloadEbook,
  type EbookMark,
  ebookResultOf,
  ebookUri,
  type HighlightColor,
  saveReadingPosition,
  saveSections,
  useEbooks,
} from '@/library/ebooks'
import {
  type FromListening,
  listeningPlaceFor,
  forgetPreparedPlace,
  type PreparedPlace,
  preparedPlace,
  useFromListening,
  useRecordingOf,
} from '@/library/listening-reading'
import { useAddMark, useDeleteMark, useEbookMarks, useUpdateMark } from '@/library/queries'
import type { TextPart } from '@/library/reading-sync'
import { closeWork, open, play, seekTo } from '@/player/controller'
import { fadeInPlayer } from '@/player/expansion'
import { usePreferences } from '@/settings/preferences'
import { FindingPlaceDialog, TextDialog } from '@/ui/dialogs'
import { useErrorText } from '@/ui/errors'
import { Empty, LoadingPage } from '@/ui/primitives'
import {
  displayPanelCover,
  overviewCard,
  overviewDuration,
  ReaderChrome,
  ReaderPage,
  useReaderPanel,
  type ReaderReturn,
  readerPalette,
} from '@/ui/reader'
import { Screen } from '@/ui/screen'

type Place = Extract<ReaderEvent, { type: 'relocate' }>

/** Where in the recording reading reached, once a switch to listening has found it. */
type FoundListening = { target: { track: number; position: number } | null }

type NoteTarget =
  | { kind: 'selection'; text: string; location: string }
  | { kind: 'highlight'; mark: EbookMark }

/** How long a let-go pinch takes to finish or spring back, as the reader times it, in ms. */
const pinchSettle = 240

/**
 * An e-book open for reading: the page fills the screen, and a tap in its middle shrinks it into
 * the overview, a card between bars with search, notes, display settings, the contents and a
 * slider through the book; pinching the page smaller opens it, and spreading it closes it again.
 * Where the reader stops is remembered as they go.
 */
export function ReaderScreen() {
  const { t } = useLingui()
  const router = useRouter()
  // `from=listening` when switched here from the player: the listening place carries over.
  const { md5, from } = useLocalSearchParams<{ md5: string; from?: string }>()
  const switched = from === 'listening'
  const ebook = useEbooks().get(md5) ?? null
  const marks = useEbookMarks(md5)
  const addMark = useAddMark(md5)
  const updateMark = useUpdateMark(md5)
  const deleteMark = useDeleteMark(md5)
  const preferences = usePreferences()
  const systemDark = useAppColorScheme() === 'dark'
  const palette = readerPalette(preferences.readerTheme, systemDark)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const view = useRef<ReaderViewHandle>(null)
  // Counts the reader views that have reported ready: its Compose host can be replaced, such as
  // when the phone's palette changes, and each new view is handed the book again.
  const [ready, setReady] = useState(0)
  const opened = useRef(false)
  const [toc, setToc] = useState<TocItem[]>([])
  // Where each part of the book starts, as the reader found it, to meet the audiobook's chapters.
  const [sections, setSections] = useState<TextPart[] | null>(null)
  const fromListening = useFromListening(ebook, sections, switched)
  const [continuing, setContinuing] = useState(false)
  // Asked once per visit; switching here from the player carries the place over without asking.
  const [asked, setAsked] = useState(false)
  const recording = useRecordingOf(ebook?.workId ?? null)
  const [switching, setSwitching] = useState(false)
  const { showFeedback } = useFeedback()
  const errorText = useErrorText()
  const [place, setPlace] = useState<Place | null>(null)
  const [chrome, setChrome] = useState(false)
  // How far the page is into the overview, from 0 to 1: animated when the overview opens or
  // closes, and moved directly by a pinch. The page, its backdrop and the bars all follow it.
  const overviewProgress = useSharedValue(0)
  const pinchSettled = useRef(false)

  useEffect(() => {
    // A pinch that ended here animates the rest of the way itself.
    if (pinchSettled.current) {
      pinchSettled.current = false

      return
    }

    overviewProgress.value = withTiming(chrome ? 1 : 0, {
      duration: overviewDuration,
      easing: Easing.bezier(0.2, 0, 0, 1),
    })
  }, [chrome, overviewProgress])
  const [selection, setSelection] = useState<{ text: string; location: string } | null>(null)
  const [sheet, setSheet] = useState<'contents' | 'notes' | null>(null)
  // The display settings open over the page being read, the overview closing for them, and close
  // when it opens again.
  const [displaying, setDisplaying] = useState(false)
  // The top bar alone over the page being read, pulled down on the page.
  const [barShown, setBarShown] = useState(false)
  const barProgress = useSharedValue(0)
  const panel = useReaderPanel(displaying)
  // Opening the display settings zooms the page back in first, and only once it is at full size
  // does the panel open over it, so the two never compete for the same frames.
  const displayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The book's search opens as a page of its own over the reader.
  const [searching, setSearching] = useState(false)
  const [openMarkId, setOpenMarkId] = useState<number | null>(null)
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null)

  const [search, setSearch] = useState<{ query: string; hits: SearchHit[]; running: boolean }>({
    query: '',
    hits: [],
    running: false,
  })

  const [failure, setFailure] = useState(false)
  // Where the reader was before jumping from the overview, to go back to.
  const [jumpedFrom, setJumpedFrom] = useState<{ location: string; fraction: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The status bar hides with the bars; the page keeps the room it had so it never reflows.
  const topInset = useRef(0)

  topInset.current = Math.max(topInset.current, insets.top)

  const allMarks = marks.data ?? []
  const highlights = allMarks.filter((mark) => mark.kind === 'highlight')
  const bookmarks = allMarks.filter((mark) => mark.kind === 'bookmark')
  const openMark = allMarks.find((mark) => mark.id === openMarkId) ?? null

  const pageEdge = Math.max(topInset.current, insets.bottom, preferences.readerMargin)

  const style: ReaderStyle = {
    fontSize: preferences.readerFontSize,
    lineHeight: preferences.readerLineHeight,
    fontFamily: preferences.readerFont,
    justify: preferences.readerJustify,
    // The same space above and below the text, counted from the screen's edges: the side margin,
    // or more where a system bar needs it, so the text stays clear of the status bar, the camera
    // and the navigation bar. The reader shares what is left of a line between the two.
    margin: pageEdge,
    marginBottom: pageEdge,
    // The side margin in points, as the renderer's share of the page width.
    gap: Math.round((preferences.readerMargin / Math.max(width, 1)) * 1000) / 10,
    background: palette.page,
    foreground: palette.text,
    link: palette.link,
  }

  const styleKey = JSON.stringify(style)
  const bookmarkKey = bookmarks.map((mark) => mark.location).join('\n')
  // What the page is told when something changes, read from the render that changed it.
  const latest = useRef({ style, highlights, bookmarks })

  latest.current = { style, highlights, bookmarks }

  // Where a reader view that comes in later opens: where the one before it was.
  const lastPlace = useRef<string | null>(null)

  // Read as the reader mounts and then forgotten, so a later visit opens at the reading place.
  const [preparedAtOpen] = useState(() => preparedPlace(md5))
  const prepared = useRef<PreparedPlace | null>(preparedAtOpen)

  useEffect(() => forgetPreparedPlace(md5), [md5])

  // The book opens once the reader is ready and its saved highlights are read; later changes to
  // the marks and style are sent on their own.
  useEffect(() => {
    if (ready === 0 || opened.current || !marks.isSuccess || ebook?.status !== 'done') {
      return
    }

    opened.current = true
    // A place prepared before opening, such as where listening stopped, is opened at instead of
    // the reading place, which the button back returns to.
    const target = lastPlace.current ? null : prepared.current

    if (target && ebook.location) {
      setJumpedFrom({ location: ebook.location, fraction: ebook.progress })
    }

    view.current?.send({
      type: 'open',
      uri: ebookUri(md5),
      location: target ? null : (lastPlace.current ?? ebook.location),
      fraction: target ? target.fraction : ebook.progress,
      // Only a place carried over from listening is marked; reading on from where reading
      // stopped needs no pointer.
      mark: Boolean(target),
      style: latest.current.style,
      annotations: latest.current.highlights.map((mark) => ({
        value: mark.location,
        color: mark.color ?? 'yellow',
        text: mark.text ?? undefined,
      })),
      bookmarks: latest.current.bookmarks.map((mark) => mark.location),
    })
  }, [ready, marks.isSuccess, ebook?.status, ebook?.location, ebook?.progress, md5])

  useEffect(() => {
    if (opened.current && styleKey) {
      view.current?.send({ type: 'style', style: latest.current.style })
    }
  }, [styleKey])

  const { height } = useWindowDimensions()
  const card = overviewCard(height, topInset.current, insets.bottom)

  // In the overview a tap anywhere on the page brings it back rather than turning it.
  useEffect(() => {
    view.current?.send({
      type: 'overview',
      on: chrome,
      scale: card.scale,
      shift: card.shift,
      gap: card.gap,
      radius: card.radius,
    })

    if (chrome) {
      setDisplaying(false)

      if (displayTimer.current) {
        clearTimeout(displayTimer.current)
        displayTimer.current = null
      }
    } else {
      setJumpedFrom(null)
    }
  }, [chrome, card.scale, card.shift, card.gap, card.radius])

  // While the display settings cover the foot of the page, the reader centres its loading
  // indicator in the part left showing, as the book lays itself out again for a new setting.
  useEffect(() => {
    view.current?.send({
      type: 'coveredBelow',
      height: displaying ? displayPanelCover + insets.bottom : 0,
    })
  }, [displaying, ready, insets.bottom])

  function openDisplay() {
    setBarShown(false)

    if (displayTimer.current) {
      clearTimeout(displayTimer.current)
      displayTimer.current = null
    }

    // Already at full size, from the bar pulled down over the page, it opens at once.
    if (!chrome) {
      setDisplaying(true)

      return
    }

    setChrome(false)
    displayTimer.current = setTimeout(() => {
      displayTimer.current = null
      setDisplaying(true)
    }, overviewDuration)
  }

  useEffect(
    () => () => {
      if (displayTimer.current) {
        clearTimeout(displayTimer.current)
      }
    },
    [],
  )

  // Back closes the display settings, or the bar pulled down over the page, before it leaves the
  // book.
  useEffect(() => {
    if (!displaying && !barShown) {
      return
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setDisplaying(false)
      setBarShown(false)

      return true
    })

    return () => subscription.remove()
  }, [displaying, barShown])

  // The bar pulled down over the page goes when the page turns, as reading carries on, and when
  // the overview opens, which brings its own.
  const shownPage = place?.pageStart ?? null

  useEffect(() => {
    setBarShown(false)
  }, [shownPage, chrome])

  useEffect(() => {
    barProgress.value = withTiming(barShown ? 1 : 0, {
      duration: overviewDuration * 0.8,
      easing: Easing.bezier(0.2, 0, 0, 1),
    })
  }, [barShown, barProgress])

  useEffect(() => {
    if (opened.current) {
      view.current?.send({
        type: 'bookmarks',
        locations: latest.current.bookmarks.map((mark) => mark.location),
      })
    }
  }, [bookmarkKey])

  // Pages turn quickly, so the place is saved once they settle, and on the way out.
  const unsaved = useRef<Place | null>(null)

  function save() {
    const pending = unsaved.current

    unsaved.current = null

    if (pending) {
      void saveReadingPosition(md5, {
        location: pending.location,
        progress: pending.fraction,
        chapter: pending.tocLabel,
        passage: pending.passage,
        page: pending.page,
        pages: pending.pages,
      })
    }
  }

  const saveOnExit = useRef(save)

  saveOnExit.current = save

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }

      saveOnExit.current()
    },
    [],
  )

  function remember(next: Place) {
    unsaved.current = next

    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
    }

    saveTimer.current = setTimeout(save, 600)
  }

  function receive(event: ReaderEvent) {
    switch (event.type) {
      case 'ready':
        opened.current = false
        setReady((count) => count + 1)
        view.current?.send({
          type: 'labels',
          showControls: t({
            message: 'Show reader controls',
            comment: 'TalkBack action on the page opening the reader’s bars',
          }),
          nextPage: t({ message: 'Next page', comment: 'TalkBack action on the reader’s page' }),
          previousPage: t({
            message: 'Previous page',
            comment: 'TalkBack action on the reader’s page',
          }),
          highlight: t({
            message: 'Highlight',
            context: 'text toolbar action',
            comment: 'Toolbar action over selected text in the reader: highlights it (a verb)',
          }),
          note: t({
            message: 'Note',
            context: 'text toolbar action',
            comment:
              'Toolbar action over selected text in the reader: adds a note to it (a verb, short)',
          }),
          copy: t({ message: 'Copy', comment: 'Toolbar action over selected text in the reader' }),
          share: t({
            message: 'Share',
            comment: 'Toolbar action over selected text in the reader',
          }),
        })
        break
      case 'opened':
        setToc(event.toc)
        {
          const parts = event.toc.flatMap((item) =>
            item.fraction === null ? [] : [{ label: item.label, fraction: item.fraction }],
          )

          setSections(parts)
          // Kept for matching the book's parts with an audiobook's chapters, even when it is closed.
          void saveSections(md5, parts)
        }

        break
      case 'relocate':
        setPlace(event)
        remember(event)
        lastPlace.current = event.location
        break
      case 'tap':
        if (selection) {
          view.current?.send({ type: 'clearSelection' })
          setSelection(null)
        } else if (displaying) {
          // A tap on the page puts the display settings away rather than opening the overview.
          setDisplaying(false)
        } else if (barShown) {
          // As it does the bar pulled down over the page.
          setBarShown(false)
        } else {
          setChrome((shown) => !shown)
        }

        break
      case 'bookmark':
        if (event.add !== null) {
          addMark.mutate({
            kind: 'bookmark',
            location: event.add,
            text: place?.tocLabel ?? null,
            note: null,
            color: null,
          })
        }

        for (const mark of bookmarks) {
          if (event.remove.includes(mark.location)) {
            deleteMark.mutate(mark.id)
          }
        }

        break
      case 'pullDown':
        if (!chrome) {
          setBarShown(true)
        }

        break
      case 'pullUp':
        setBarShown(false)
        break
      case 'pinchProgress':
        // The fingers move the whole transition; let go, it finishes or settles back.
        // Pinched in from the page or spread out from the overview, `open` is where it ends.
        if (!event.ended) {
          cancelAnimation(overviewProgress)
          overviewProgress.value = event.value
        } else {
          overviewProgress.value = withTiming(event.open ? 1 : 0, {
            duration: pinchSettle,
            easing: Easing.out(Easing.cubic),
          })
          pinchSettled.current = event.open !== chrome
          setChrome(event.open)
        }

        break
      case 'selection':
        setSelection(
          event.text && event.location ? { text: event.text, location: event.location } : null,
        )
        break
      case 'selectionAction':
        if (event.action === 'highlight') {
          // In the colour used last, which the highlight's own sheet can change.
          highlight(highlights.at(-1)?.color ?? 'yellow')
        } else if (selection) {
          setNoteTarget({ kind: 'selection', ...selection })
        }

        break
      case 'showAnnotation':
        setOpenMarkId(highlights.find((mark) => mark.location === event.value)?.id ?? null)
        break
      case 'searchResult':
        setSearch((current) => ({
          ...current,
          hits: [
            ...current.hits,
            {
              location: event.location,
              label: event.label,
              excerpt: event.excerpt ?? '',
              match:
                event.excerpt && event.matchStart !== null && event.matchLength
                  ? { start: event.matchStart, length: event.matchLength }
                  : null,
            },
          ],
        }))
        break
      case 'passage':
        // Not found, the book stays at the chapter estimate it already moved to.
        break
      case 'searchDone':
        setSearch((current) => ({ ...current, running: false }))
        break
      case 'error':
        if (!opened.current || !place) {
          setFailure(true)
        }

        break
    }
  }

  function highlight(
    color: HighlightColor,
    note: string | null = null,
    selected: { text: string; location: string } | null = selection,
  ) {
    if (!selected) {
      return
    }

    addMark.mutate({
      kind: 'highlight',
      location: selected.location,
      text: selected.text,
      note,
      color,
    })
    view.current?.send({
      type: 'addAnnotation',
      annotation: { value: selected.location, color, text: selected.text },
    })
    view.current?.send({ type: 'clearSelection' })
    setSelection(null)
  }

  function removeMark(mark: EbookMark) {
    deleteMark.mutate(mark.id)

    if (mark.kind === 'highlight') {
      view.current?.send({ type: 'removeAnnotation', value: mark.location })
    }
  }

  function recolor(mark: EbookMark, color: HighlightColor) {
    updateMark.mutate({ id: mark.id, note: mark.note, color })
    view.current?.send({ type: 'removeAnnotation', value: mark.location })
    view.current?.send({
      type: 'addAnnotation',
      annotation: { value: mark.location, color, text: mark.text ?? undefined },
    })
  }

  /** Moves to another place from the overview, remembering where the reader was to go back. */
  function jump(command: () => void) {
    if (!jumpedFrom && place) {
      setJumpedFrom({ location: place.location, fraction: place.fraction })
    }

    command()
  }

  /**
   * Moves to where the book was last listened to: the chapter estimate at once, then, with the
   * exact mode, where the words heard just before stopping are in the text.
   */
  async function continueFromListening(offer: FromListening) {
    setContinuing(true)
    jump(() => view.current?.send({ type: 'goToFraction', fraction: offer.fraction }))

    try {
      const words = await offer.hear()

      if (words && words.length >= 3) {
        view.current?.send({ type: 'findPassage', words, fraction: offer.fraction, anchor: 'end' })
      }
    } catch {
      // The estimate stands when the audio cannot be heard.
    } finally {
      setContinuing(false)
      setAsked(true)
      fromListening.dismiss()
    }
  }

  const offer = fromListening.offer
  const shown = place !== null

  // Words heard before opening find the exact place as soon as the book shows.
  useEffect(() => {
    const words = prepared.current?.words

    if (place && words && words.length >= 3 && prepared.current) {
      const { fraction } = prepared.current

      prepared.current = null
      view.current?.send({ type: 'findPassage', words, fraction, anchor: 'end' })
    }
  }, [place])

  // Hearing the words takes a moment, so a switch then says it is finding the place.
  const findingSwitch = preferences.readingSync === 'words' && switched && continuing && !asked

  // Reading takes over from listening to the same book: once the book shows, the player holding a
  // recording of it stops and goes, out of sight behind the reader. Cancelling on the way here
  // never reaches this, so the mini player stays then.
  const stoppedListening = useRef(false)

  useEffect(() => {
    const workId = ebook?.workId

    if (shown && workId && !stoppedListening.current) {
      stoppedListening.current = true
      void closeWork(workId).catch(() => undefined)
    }
  }, [shown, ebook?.workId])

  // Chosen before opening, or switched here from the player, the book moves to where listening
  // stopped as soon as it shows.
  useEffect(() => {
    if (switched && offer && shown && !asked && !continuing) {
      void continueFromListening(offer)
    }
  })

  /**
   * Switches to listening from the place being read: it is saved, the recording moves to it and
   * plays, and the player opens over the screen the reader was opened from.
   */
  async function switchToListening() {
    if (!recording || !place || switching) {
      return
    }

    setSwitching(true)
    unsaved.current = place
    save()

    const reading = place
    // Filled in by the finding, which runs in the dialog.
    const result: FoundListening = { target: null }

    const work: PlaceWork = {
      busy: t({
        message: 'Finding the place…',
        comment: 'Shown while the place to pick the book up from is found',
      }),
      run: async () => {
        result.target =
          preferences.readingSync !== 'off' && sections
            ? await listeningPlaceFor(recording, {
                progress: reading.fraction,
                passage: reading.passage,
                sections,
                language: ebook?.language ?? null,
              })
            : null
      },
    }

    try {
      // The place is found over the reader, which can cancel it; only then does the player open.
      const found = findingTakesTime()
        ? await findPlace(t({ message: 'Switching to listening', comment: 'Dialog title' }), work)
        : await work.run(new AbortController().signal).then(() => true)

      if (!found) {
        return
      }

      await open(recording.id, false)

      const landing = result.target

      if (landing) {
        await seekTo(landing.track, landing.position)
      }

      play(true)
      router.back()
      // The full player fades in over the screen the reader was opened from.
      fadeInPlayer()
    } catch (error) {
      showFeedback(errorText(error instanceof Error ? error : null))
    } finally {
      setSwitching(false)
    }
  }

  function runSearch(query: string) {
    setSearch({ query, hits: [], running: query.length > 0 })
    view.current?.send(query ? { type: 'search', query } : { type: 'clearSearch' })
  }

  if (failure) {
    return (
      <Screen title='' navigation='back' miniPlayer={false}>
        <Empty
          glyph='warning'
          height='fill'
          title={t({
            message: 'This e-book could not be opened',
            comment: 'Reader failed to open a downloaded file',
          })}
          message={t({
            message:
              'The file may be damaged. Try again, or choose another e-book on the book’s page.',
            comment: 'Explains a reader failure and what to do about it',
          })}
          actionLabel={t({
            message: 'Try again',
            comment: 'Reopens an e-book that failed to open',
          })}
          onAction={() => setFailure(false)}
        />
      </Screen>
    )
  }

  if (!ebook || ebook.status !== 'done') {
    return (
      <Screen title='' navigation='back' miniPlayer={false}>
        {ebook?.status === 'downloading' ? (
          <LoadingPage />
        ) : (
          <Empty
            glyph='read'
            height='fill'
            title={t({
              message: 'This e-book is not on your phone',
              comment: 'Reader opened for an e-book that was removed or failed to download',
            })}
            actionLabel={
              ebook
                ? t({
                    message: 'Download',
                    comment: 'Downloads the e-book again from the reader when it is missing',
                  })
                : undefined
            }
            onAction={
              ebook
                ? () =>
                    void downloadEbook(ebookResultOf(ebook), ebook.workId).catch((error: Error) =>
                      showFeedback(errorText(error)),
                    )
                : undefined
            }
          />
        )}
      </Screen>
    )
  }

  const pagesLeft = place?.sectionPagesLeft ?? null
  const minutesLeft = place?.sectionMinutesLeft ?? null
  const roundedMinutes = minutesLeft === null ? null : Math.round(minutesLeft)

  // Pages left in the chapter when the book turns pages; reading time left when it scrolls.
  const status =
    pagesLeft !== null
      ? pagesLeft === 0
        ? t({
            message: 'Last page',
            comment: 'Reader overview: the page showing is the chapter’s last',
          })
        : t({
            message: plural(pagesLeft, {
              one: '# page left',
              other: '# pages left',
            }),
            comment: 'Reader overview: pages left in the current chapter, under its name',
          })
      : roundedMinutes === null
        ? null
        : roundedMinutes < 1
          ? t({
              message: 'Less than a minute left',
              comment: 'Reader overview: reading time left in the current chapter, under its name',
            })
          : t({
              message: plural(roundedMinutes, {
                one: '# min left',
                other: '# min left',
              }),
              comment: 'Reader overview: reading time left in the current chapter, under its name',
            })

  const fraction = place?.fraction ?? ebook.progress

  const returnTo: ReaderReturn | null = jumpedFrom
    ? {
        fraction: jumpedFrom.fraction,
        label: t({
          message: 'Back to where you were',
          comment: 'Marker above the reader’s slider returning to the place before a jump',
        }),
        onPress: () => {
          view.current?.send({ type: 'goTo', target: jumpedFrom.location })
          setJumpedFrom(null)
        },
      }
    : null

  return (
    <View style={{ flex: 1 }}>
      {/* The status bar shows with the bars, and throughout the search page. */}
      <StatusBar
        hidden={!chrome && !searching && !barShown}
        style={palette.scheme === 'dark' ? 'light' : 'dark'}
      />
      <ReaderPage
        progress={overviewProgress}
        palette={palette}
        onToggle={() => setChrome((shown) => !shown)}
      >
        <ReaderView ref={view} onEvent={receive} />
      </ReaderPage>
      <ReaderChrome
        visible={chrome}
        progress={overviewProgress}
        bar={barProgress}
        palette={palette}
        onBack={() => router.back()}
        onSearch={() => setSearching(true)}
        onListen={recording ? () => void switchToListening() : null}
        onContents={() => setSheet('contents')}
        onNotes={() => setSheet('notes')}
        onDisplay={openDisplay}
        panel={{
          progress: panel.progress,
          open: displaying,
          content: panel.mounted ? (
            <DisplayPanel
              palette={palette}
              systemDark={systemDark}
              onClose={() => setDisplaying(false)}
            />
          ) : null,
        }}
        chapter={place?.tocLabel ?? null}
        status={status}
        fraction={fraction}
        onSeek={(next, settled) =>
          jump(() => view.current?.send({ type: 'scrub', fraction: next, settle: settled }))
        }
        returnTo={returnTo}
        longestChapter={toc.reduce(
          (longest, item) => (item.label.length > longest.length ? item.label : longest),
          '',
        )}
        pages={place?.page && place.pages ? { current: place.page, total: place.pages } : null}
        topInset={topInset.current}
        bottomInset={insets.bottom}
      >
        {sheet === 'contents' ? (
          <ContentsSheet
            toc={toc}
            currentHref={place?.tocHref ?? null}
            onSelect={(href) => jump(() => view.current?.send({ type: 'goTo', target: href }))}
            onDismiss={() => setSheet(null)}
          />
        ) : null}
        {sheet === 'notes' ? (
          <NotesSheet
            marks={allMarks}
            onOpen={(mark) =>
              jump(() => view.current?.send({ type: 'goTo', target: mark.location }))
            }
            onDelete={removeMark}
            onDismiss={() => setSheet(null)}
          />
        ) : null}
        {openMark ? (
          <HighlightSheet
            mark={openMark}
            onColor={(color) => recolor(openMark, color)}
            onEditNote={() => setNoteTarget({ kind: 'highlight', mark: openMark })}
            onRemoveNote={() =>
              updateMark.mutate({ id: openMark.id, note: null, color: openMark.color })
            }
            onShare={() => {
              const passage = openMark.text ?? ''
              const title = ebook.title

              void Share.share({
                message: t({
                  message: `“${passage}”\n— ${title}`,
                  comment:
                    'A shared highlight: the passage in quotation marks, then the book title',
                }),
              })
            }}
            onDelete={() => removeMark(openMark)}
            onDismiss={() => setOpenMarkId(null)}
          />
        ) : null}
        {noteTarget ? (
          <TextDialog
            title={t({ message: 'Note', comment: 'Title of the dialog for a highlight’s note' })}
            label={t({ message: 'Your note', comment: 'Field label in the note dialog' })}
            initialValue={noteTarget.kind === 'highlight' ? (noteTarget.mark.note ?? '') : ''}
            multiline
            confirmLabel={t({ message: 'Save', comment: 'Saves a note' })}
            onConfirm={async (note) => {
              if (noteTarget.kind === 'selection') {
                // The selection may have gone as the dialog took focus, so the one it was
                // opened for is highlighted.
                highlight('yellow', note, noteTarget)
              } else {
                await updateMark.mutateAsync({
                  id: noteTarget.mark.id,
                  note,
                  color: noteTarget.mark.color,
                })
              }

              setNoteTarget(null)

              return null
            }}
            onDismiss={() => setNoteTarget(null)}
          />
        ) : null}
      </ReaderChrome>
      {/* Compose, so it sits in a host of its own over the reader. */}
      {findingSwitch ? (
        <Host style={{ position: 'absolute', width: 1, height: 1 }}>
          <FindingPlaceDialog
            title={t({ message: 'Switching to reading', comment: 'Dialog title' })}
            message={t({
              message: 'Finding the place…',
              comment: 'Shown while the place to pick the book up from is found',
            })}
            onCancel={() => setAsked(true)}
          />
        </Host>
      ) : null}
      {searching ? (
        <BookSearchPage
          palette={palette}
          bottomInset={insets.bottom}
          query={search.query}
          results={search.hits}
          searching={search.running}
          onSearch={runSearch}
          onSelect={(hit) => {
            view.current?.send({ type: 'goTo', target: hit.location })
            setSearching(false)
            setChrome(false)
          }}
          onBack={() => setSearching(false)}
        />
      ) : null}
    </View>
  )
}
