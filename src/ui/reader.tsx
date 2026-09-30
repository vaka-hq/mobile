import { getMaterialColors } from '@expo/ui/jetpack-compose'
import { useLingui } from '@lingui/react/macro'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { Host } from '@/components/host'
import {
  animateContentSize,
  background,
  clickable,
  clip,
  composeGeometry,
  fillMaxSize,
  fillMaxWidth,
  height,
  padding,
  size,
  weight,
  width,
  selectable,
  selectableGroup,
  fillMaxHeight,
  imePadding,
} from '@/lib/compose-modifiers'
import {
  Box,
  Column,
  Icon,
  IconButton,
  Row,
  Slider,
  Text,
  useMaterialColors,
} from '@/lib/compose-ui'
import { type HighlightColor, highlightColors } from '@/library/ebooks'
import { TopAppBar } from '../../modules/android-components'
import { SideReveal } from '../../modules/android-components'
import { type Glyph, glyphs } from './glyphs'
import { Action } from './screen'

/**
 * The reading themes: the page light or dark. `auto`, the setting until one is picked, follows the
 * phone's appearance.
 */
export type ReaderTheme = 'auto' | 'light' | 'dark'

/** The theme the page shows in: the one picked, or else the phone's appearance. */
export function shownTheme(theme: ReaderTheme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme
}

/**
 * The reader's colours. The page, its text and links follow the reading theme; everything around
 * the page, the bars, sheets, search and the display panel, follows the phone like the rest of the
 * app: `scheme`, the bars, the app's own surface, and the panel's card, quieter text, and its
 * choices' track and chosen segment.
 */
export type ReaderPalette = {
  scheme: 'light' | 'dark'
  page: string
  text: string
  link: string
  surface: string
  onSurface: string
  bar: string
  card: string
  muted: string
  track: string
  chosen: string
  onChosen: string
}

/** The reader's colours for a theme, from the phone's Material palette in each scheme. */
export function readerPalette(theme: ReaderTheme, systemDark: boolean): ReaderPalette {
  const scheme = systemDark ? 'dark' : 'light'
  const page = getMaterialColors({ scheme: shownTheme(theme, systemDark) })
  const app = getMaterialColors({ scheme })

  return {
    scheme,
    page: String(page.surface),
    text: String(page.onSurface),
    link: String(page.primary),
    surface: String(app.surface),
    onSurface: String(app.onSurface),
    bar: String(app.surfaceContainer),
    card: String(app.surfaceContainerHigh),
    muted: String(app.onSurfaceVariant),
    track: String(app.surfaceContainerHighest),
    chosen: String(app.secondaryContainer),
    onChosen: String(app.onSecondaryContainer),
  }
}

/**
 * A page of its own over the reader, in the app's colours: a search bar at the top
 * with a way back, and whatever it found filling the rest. Back closes it, as the arrow does.
 */
export function ReaderSearchPage({
  palette,
  searchBar,
  onBack,
  children,
}: {
  palette: ReaderPalette
  /** The search field in the app's top bar, which keeps clear of the status bar itself. */
  searchBar: ReactNode
  onBack: () => void
  /** What was found, or where it stands, filling the page below the bar. */
  children: ReactNode
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack()

      return true
    })

    return () => subscription.remove()
  }, [onBack])

  return (
    <View style={StyleSheet.absoluteFill}>
      <Host style={{ flex: 1 }} colorScheme={palette.scheme}>
        <Column
          modifiers={[
            fillMaxSize(),
            background(palette.surface),
            // Takes every touch on the page, so none falls through to the reader underneath,
            // where a tap or a swipe would work the book and its bars.
            clickable(() => undefined, { indication: false }),
          ]}
        >
          {searchBar}
          {/* Above the keyboard while it is open, so what the page shows centres in what is left. */}
          <Box modifiers={[fillMaxWidth(), weight(1), imePadding()]}>{children}</Box>
        </Column>
      </Host>
    </View>
  )
}

/** Swatches for the highlight colours, opaque versions of the fills drawn over the text. */
const highlightSwatches: Record<HighlightColor, string> = {
  yellow: '#FFD54F',
  green: '#81C784',
  blue: '#64B5F6',
  pink: '#F06292',
}

/** A filled circle inside a ring of another colour, such as a chosen swatch. */
function Ring({
  diameter,
  ring,
  width,
  fill,
  children,
}: {
  diameter: number
  ring: string
  width: number
  fill: string
  children: ReactNode
}) {
  return (
    <Box
      modifiers={[
        size(diameter, diameter),
        clip(composeGeometry.Circle),
        background(ring),
        padding(width, width, width, width),
      ]}
    >
      <Box
        contentAlignment='center'
        modifiers={[fillMaxSize(), clip(composeGeometry.Circle), background(fill)]}
      >
        {children}
      </Box>
    </Box>
  )
}

/** Round colour choices for highlights, the chosen one ringed and checked. */
export function HighlightColors({
  selected,
  onSelect,
}: {
  selected?: HighlightColor | null
  onSelect: (color: HighlightColor) => void
}) {
  const { t } = useLingui()
  const colors = useMaterialColors()

  const names: Record<HighlightColor, string> = {
    yellow: t({ message: 'Yellow', comment: 'Highlight colour' }),
    green: t({ message: 'Green', comment: 'Highlight colour' }),
    blue: t({ message: 'Blue', comment: 'Highlight colour' }),
    pink: t({ message: 'Pink', comment: 'Highlight colour' }),
  }

  return (
    <Row horizontalArrangement={{ spacedBy: 4 }} verticalAlignment='center'>
      {highlightColors.map((color) => (
        <Box
          key={color}
          contentAlignment='center'
          modifiers={[
            size(48, 48),
            clip(composeGeometry.Circle),
            // Read as a set of radio buttons, the chosen colour announced as selected.
            selectable(selected === color, () => onSelect(color), 'radioButton'),
          ]}
        >
          <Ring
            diameter={32}
            ring={selected === color ? String(colors.onSurface) : highlightSwatches[color]}
            width={2}
            fill={highlightSwatches[color]}
          >
            <Icon
              source={glyphs.check}
              size={18}
              // Always there, only hidden, since icons load asynchronously.
              tint={selected === color ? '#1F1F1F' : 'transparent'}
              contentDescription={names[color]}
            />
          </Ring>
        </Box>
      ))}
    </Row>
  )
}

/** Height of the overview's foot: the chapter, what is left of it and the slider, in dp. */
const overviewFootHeight = 120

/** Height of the top app bar, in dp. */
const appBarHeight = 64

/** Space between the page card and the bars around it, in dp. */
const overviewGap = 12

/** The page card's corner radius in the overview, in dp. */
const cardRadius = 20

/** How long the page takes to shrink into the overview and grow back, in milliseconds. */
export const overviewDuration = 320

/** The display panel's rows and the space around them, in dp; its height is their sum. */
const panelPadding = 12

/** The panel's title row, as tall as its buttons' touch targets so all of it centres alike. */
const panelHeaderHeight = 48

/** A setting's row: its name at the start and its control at the end. */
const settingHeight = 40

/** Height of a setting's control inside its row, in dp. */
const choicesHeight = 36

const settingCount = 6

const settingGap = 4

/** Room for the settings' names, so their controls line up. */
const settingLabelWidth = 100

const panelHeight =
  panelPadding * 2 + panelHeaderHeight + (settingHeight + settingGap) * settingCount

/** Space between the display panel and the screen's edges, so the page shows all around it, in dp. */
const panelMargin = 24

/** The widest the display panel gets, in dp. */
const panelMaxWidth = 380

/** How much of the page the display panel covers from below, above the navigation bar, in dp. */
export const displayPanelCover = panelHeight + panelMargin

/**
 * Where the page card sits in the overview, between the bars: its scale, how far its middle moves
 * down from the page's, the gap to the cards beside it and its corners, all in dp.
 */
export function overviewCard(height: number, topInset: number, bottomInset: number) {
  // The page fills the screen, under the system bars too, which its margins keep clear of.
  const pageHeight = Math.max(1, height)
  const cardTop = topInset + appBarHeight + overviewGap
  const cardSpace = Math.max(1, height - cardTop - overviewFootHeight - bottomInset - overviewGap)
  const scale = Math.min(cardSpace / pageHeight, 0.82)

  return {
    pageHeight,
    cardTop,
    cardSpace,
    scale,
    shift: cardTop + cardSpace / 2 - pageHeight / 2,
    gap: overviewGap,
    radius: cardRadius,
  }
}

/** How long the display panel takes to fade in and out, in milliseconds. */
const panelFade = 220

/**
 * Time for the panel's Compose tree to be built and drawn once before it fades in, so building it
 * never holds up a frame of the fade, in milliseconds.
 */
const panelSettle = 48

/**
 * The display panel's state: how far it is open, from 0 to 1, and whether it is drawn. Opening,
 * it is drawn first and fades in a moment later; closing, it fades out and is then let go.
 */
export function useReaderPanel(open: boolean) {
  const progress = useSharedValue(0)
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      progress.value = withDelay(
        panelSettle,
        withTiming(1, { duration: panelFade, easing: Easing.bezier(0.2, 0, 0, 1) }),
      )

      return
    }

    progress.value = withTiming(0, { duration: panelFade * 0.7 }, (finished) => {
      if (finished) {
        scheduleOnRN(setMounted, false)
      }
    })
  }, [open, progress])

  return { progress, mounted }
}

/**
 * The page and the overview it shrinks into, as Play Books has it: tapping the middle of the page
 * scales it down into a card between the bars, with the pages either side peeking in; tapping the
 * card, or around it, grows it back. The reader inside draws the cards itself, turning pages and
 * scrolling the row natively; here the page only takes the space it fills and the backdrop fades.
 */
export function ReaderPage({
  progress,
  palette,
  onToggle,
  children,
}: {
  /** How far into the overview the page is, from 0 to 1, shared with the bars. */
  progress: SharedValue<number>
  palette: ReaderPalette
  /** A tap outside the page itself opens or closes the bars. */
  onToggle: () => void
  children: ReactNode
}) {
  // The whole screen, under the system bars too; the text's margins keep it clear of them.
  const { width, height } = useWindowDimensions()

  const backdrop = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [palette.page, palette.bar]),
  }))

  return (
    <Animated.View style={[{ flex: 1 }, backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onToggle} />
      <View style={{ position: 'absolute', top: 0, left: 0, width, height }}>{children}</View>
    </Animated.View>
  )
}

/** Where the reader was before jumping, to go back to from the overview's slider. */
export type ReaderReturn = { fraction: number; label: string; onPress: () => void }

export type ReaderChromeProps = {
  /** The overview is open: the bars show around the page card. */
  visible: boolean
  /** How far into the overview the page is, from 0 to 1; the bars slide in with it. */
  progress: SharedValue<number>
  /**
   * How far the top bar alone is shown over the page being read, from 0 to 1, as when it is
   * pulled down on the page; the foot stays away.
   */
  bar: SharedValue<number>
  palette: ReaderPalette
  onBack: () => void
  /** Switches to listening from the place being read; null when the book has no recording. */
  onListen: (() => void) | null
  onSearch: () => void
  onContents: () => void
  onNotes: () => void
  onDisplay: () => void
  /**
   * The display panel, a card over the foot of the page being read: how far it is open, from 0 to
   * 1, whether it is, and what it holds, drawn while it is open or fading out and null otherwise.
   */
  panel: { progress: SharedValue<number>; open: boolean; content: ReactNode | null }
  /** The chapter being read and what is left of it, above the position slider. */
  chapter: string | null
  status: string | null
  /** How far through the book, from 0 to 1. */
  fraction: number
  /** The slider moved: the pages follow while dragging, and the book settles where it is let go. */
  onSeek: (fraction: number, settled: boolean) => void
  /** A marker above the slider back to where the reader jumped from. */
  returnTo: ReaderReturn | null
  /** The book's longest chapter name, which the chapter's box is sized to so nothing moves. */
  longestChapter: string
  /** The page being read and how many the book has, when the reader counts them. */
  pages: { current: number; total: number } | null
  /** Room for the status bar above the app bar, in dp. */
  topInset: number
  /** Room for the system navigation bar below the bottom bar, in dp. */
  bottomInset: number
  /** Sheets and dialogs, drawn in the reader's own colours. */
  children?: ReactNode
}

/** How far the display panel rises as it fades in, in dp. */
const panelSink = 16

/** Space above the overview foot's chapter, and between it and the slider, in dp. */
const footPadding = 12

/** The overview foot's padding at its two sides together, in dp. */
const footSides = 24

/** About the width of a character in the chapter's name and in the count under it, in dp. */
const titleCharWidth = 7

const countCharWidth = 5.6

/** Characters in the longest count under the chapter, such as “888 pages left”. */
const countChars = 14

/** The narrowest the chapter's box gets, in dp. */
const minLabelWidth = 80

/** Width of the button back to where the reader was, in dp. */
const returnWidth = 48

/** Room for the widest share, “100 %”, beside that button, in dp. */
const percentWidth = 52

/** Space between the chapter and the button back, in dp. */
const returnGap = 4

/**
 * The overview's bars around the page card, in the reading theme's colours: the app bar with
 * search, notes and bookmarks, and display, and at the foot the chapter, what is left of it, the
 * contents and a slider through the book that moves the page as it is dragged. The bars sit in
 * two Compose trees, one at each edge, so the middle of the screen, the page card and the pages
 * either side, stays free for touches.
 */
export function ReaderChrome({
  visible,
  progress,
  bar,
  palette,
  onBack,
  onListen,
  onSearch,
  onContents,
  onNotes,
  onDisplay,
  panel,
  chapter,
  status,
  fraction,
  onSeek,
  returnTo,
  longestChapter,
  pages,
  topInset,
  bottomInset,
  children,
}: ReaderChromeProps) {
  const { t, i18n } = useLingui()
  const colors = useMaterialColors()
  const [dragging, setDragging] = useState<number | null>(null)
  // The latest drag, read when it ends: the release can arrive before React renders the value.
  const drag = useRef<number | null>(null)
  // Where the handle was let go, held until the book reports it has moved there.
  const [landing, setLanding] = useState<number | null>(null)
  const shown = dragging ?? landing ?? fraction

  useEffect(() => {
    if (landing === null) {
      return
    }

    if (Math.abs(fraction - landing) < 0.02) {
      setLanding(null)

      return
    }

    // A move that lands further off, such as at a chapter's start, lets go after a moment.
    const timeout = setTimeout(() => setLanding(null), 1500)

    return () => clearTimeout(timeout)
  }, [fraction, landing])

  // The page count, following the handle while it moves so the count never jumps back.
  const count = pages
    ? `${i18n.number(
        dragging === null && landing === null
          ? pages.current
          : Math.min(pages.total, Math.max(1, Math.round(shown * (pages.total - 1)) + 1)),
      )} / ${i18n.number(pages.total)}`
    : i18n.number(shown, { style: 'percent' })

  // The app bar comes down from the top and the foot up from the bottom as the page moves into the
  // overview, following it step for step, whether a tap animates it or a pinch moves it.
  const topHeight = topInset + appBarHeight
  const footHeight = overviewFootHeight + bottomInset

  // The bars take the same colour as the backdrop behind the pages at every step, from the page's
  // colour to the bars' own, so bars and backdrop change together both ways.
  // The top bar comes with the overview, or alone over the page when it is pulled down.
  const topStyle = useAnimatedStyle(() => {
    const shown = Math.max(progress.value, bar.value)

    return {
      transform: [{ translateY: -(1 - shown) * topHeight }],
      backgroundColor: interpolateColor(shown, [0, 1], [palette.page, palette.bar]),
    }
  })

  const footStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * footHeight }],
    backgroundColor: interpolateColor(progress.value, [0, 1], [palette.page, palette.bar]),
  }))

  // Taken out of `panel`, whose content cannot go to the UI thread with it.
  const opened = panel.progress

  // The display panel rises a little as it fades in over the page.
  const panelStyle = useAnimatedStyle(() => ({
    opacity: opened.value,
    transform: [{ translateY: (1 - opened.value) * panelSink }],
  }))

  const { width: screenWidth } = useWindowDimensions()
  const panelWidth = Math.min(screenWidth - panelMargin * 2, panelMaxWidth)

  // The chapter's box is as wide as the book's longest chapter name or the longest count under
  // it, so the group sits together in the middle and nothing moves as either changes.
  const room = screenWidth - footSides - (returnGap + returnWidth + 8 + percentWidth)

  const labelWidth = Math.min(
    room,
    Math.max(
      minLabelWidth,
      Math.ceil(longestChapter.length * titleCharWidth),
      Math.ceil(countChars * countCharWidth),
    ),
  )

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      <Animated.View
        style={[{ position: 'absolute', top: 0, left: 0, right: 0, height: topHeight }, topStyle]}
      >
        <Host style={{ flex: 1 }} colorScheme={palette.scheme}>
          <TopAppBar
            title=''
            // Clear, so the animated colour behind it shows.
            containerColor='#00000000'
            navigationIcon={
              <Action
                glyph='back'
                label={t({
                  message: 'Back',
                  comment: 'Top bar button returning to the previous screen',
                })}
                onPress={onBack}
              />
            }
            actions={
              <Row verticalAlignment='center'>
                {onListen ? (
                  <Action
                    glyph='listen'
                    label={t({
                      message: 'Listen from here',
                      comment: 'Reader bar button playing the audiobook from the page being read',
                    })}
                    onPress={onListen}
                  />
                ) : null}
                <Action
                  glyph='search'
                  label={t({ message: 'Search in book', comment: 'Reader top bar button' })}
                  onPress={onSearch}
                />
                <Action
                  glyph='bookmarks'
                  label={t({
                    message: 'Notes',
                    comment: 'Reader bar button for highlights and bookmarks',
                  })}
                  onPress={onNotes}
                />
                <Action
                  glyph='display'
                  label={t({ message: 'Display', comment: 'Reader bar button for text settings' })}
                  onPress={onDisplay}
                />
              </Row>
            }
          />
        </Host>
      </Animated.View>
      <Host
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: footHeight,
        }}
        colorScheme={palette.scheme}
      >
        <Column modifiers={[fillMaxSize()]}>
          <Box modifiers={[weight(1)]} />
          {/* Room for the foot below, while the overview is open. */}
          <Box modifiers={[fillMaxWidth(), height(visible ? footHeight : 0)]} />
        </Column>
        {children}
      </Host>
      <Animated.View
        style={[
          { position: 'absolute', left: 0, right: 0, bottom: 0, height: footHeight },
          footStyle,
        ]}
      >
        <Host style={{ flex: 1 }} colorScheme={palette.scheme}>
          <Column
            horizontalAlignment='center'
            modifiers={[
              fillMaxWidth(),
              height(overviewFootHeight + bottomInset),
              padding(8, footPadding, 16, bottomInset),
            ]}
          >
            {/*
                The chapter and what is left of it, centred. After a jump the way back and how far
                into the book the reader is join them on the right, and the pair slides over to
                stay centred; going back or reading on lets them go again.
              */}
            <Row
              horizontalArrangement='center'
              verticalAlignment='center'
              modifiers={[fillMaxWidth(), animateContentSize()]}
            >
              {/* A fixed width, so a longer name or count never moves the button beside it. */}
              <Column horizontalAlignment='center' modifiers={[width(labelWidth)]}>
                <Text maxLines={1} overflow='ellipsis' style={{ typography: 'titleSmall' }}>
                  {chapter ?? ''}
                </Text>
                <Text
                  maxLines={1}
                  color={colors.onSurfaceVariant}
                  style={{ typography: 'bodySmall' }}
                >
                  {status ?? ''}
                </Text>
              </Column>
              {/* Fades in whole as it moves out to its place, rather than being uncovered. */}
              <SideReveal visible={returnTo !== null}>
                <Row verticalAlignment='center' modifiers={[padding(returnGap, 0, 0, 0)]}>
                  <Box
                    contentAlignment='center'
                    modifiers={[
                      size(returnWidth, 32),
                      clip(composeGeometry.RoundedCorner(16)),
                      background(colors.secondaryContainer),
                      clickable(() => returnTo?.onPress()),
                    ]}
                  >
                    <Icon
                      source={glyphs.jumpBack}
                      size={18}
                      tint={colors.onSecondaryContainer}
                      contentDescription={
                        returnTo?.label ??
                        t({
                          message: 'Back to where you were',
                          comment:
                            'Marker above the reader’s slider returning to the place before a jump',
                        })
                      }
                    />
                  </Box>
                  <Text
                    maxLines={1}
                    style={{ typography: 'labelLarge' }}
                    modifiers={[padding(8, 0, 0, 0), width(percentWidth)]}
                  >
                    {i18n.number(shown, { style: 'percent' })}
                  </Text>
                </Row>
              </SideReveal>
            </Row>
            <Row verticalAlignment='center' modifiers={[fillMaxWidth(), weight(1)]}>
              <Action
                glyph='chapters'
                label={t({ message: 'Contents', comment: 'Reader bar button' })}
                onPress={onContents}
              />
              <Box modifiers={[weight(1)]}>
                <Slider
                  value={shown}
                  min={0}
                  max={1}
                  onValueChange={(value) => {
                    drag.current = value
                    setDragging(value)
                    // The row of pages follows every move; the reader draws it natively.
                    onSeek(value, false)
                  }}
                  onValueChangeFinished={() => {
                    if (drag.current !== null) {
                      onSeek(drag.current, true)
                      // The handle stays where it was let go until the book has moved there.
                      setLanding(drag.current)
                    }

                    drag.current = null
                    setDragging(null)
                  }}
                  modifiers={[fillMaxWidth()]}
                />
              </Box>
              <Text
                maxLines={1}
                style={{ typography: 'labelLarge' }}
                modifiers={[padding(12, 0, 0, 0)]}
              >
                {count}
              </Text>
            </Row>
          </Column>
        </Host>
      </Animated.View>
      {panel.content ? (
        <Animated.View
          pointerEvents={panel.open ? 'auto' : 'none'}
          style={[
            {
              position: 'absolute',
              left: (screenWidth - panelWidth) / 2,
              width: panelWidth,
              bottom: bottomInset + panelMargin,
              height: panelHeight,
            },
            panelStyle,
          ]}
        >
          <Host style={{ flex: 1 }} colorScheme={palette.scheme}>
            {panel.content}
          </Host>
        </Animated.View>
      ) : null}
    </View>
  )
}

/**
 * The display panel's card, over the foot of the page being read with the page showing all around
 * it: a title with a close button, then one setting to a row, its name at the start and its control
 * at the end, so the page above shows each change as it is made.
 */
export function ReaderPanel({
  palette,
  title,
  closeLabel,
  onClose,
  reset,
  children,
}: {
  palette: ReaderPalette
  title: string
  closeLabel: string
  onClose: () => void
  /** Puts the settings back as they started; its button shows while any differs. */
  reset: { label: string; visible: boolean; onPress: () => void }
  children: ReactNode
}) {
  return (
    <Column
      verticalArrangement={{ spacedBy: settingGap }}
      modifiers={[
        fillMaxSize(),
        clip(composeGeometry.RoundedCorner(28)),
        background(palette.card),
        padding(20, panelPadding, 8, panelPadding),
      ]}
    >
      <Row verticalAlignment='center' modifiers={[fillMaxWidth(), height(panelHeaderHeight)]}>
        <Box contentAlignment='centerStart' modifiers={[weight(1), fillMaxHeight()]}>
          <Text color={palette.onSurface} maxLines={1} style={{ typography: 'titleMedium' }}>
            {title}
          </Text>
        </Box>
        {/* Fades in as it travels out from beside the close button, its room opening before it. */}
        <SideReveal visible={reset.visible}>
          <IconButton onClick={reset.onPress}>
            <Icon
              source={glyphs.resetSettings}
              size={24}
              tint={palette.onSurface}
              contentDescription={reset.label}
            />
          </IconButton>
        </SideReveal>
        <IconButton onClick={onClose}>
          <Icon
            source={glyphs.close}
            size={24}
            tint={palette.onSurface}
            contentDescription={closeLabel}
          />
        </IconButton>
      </Row>
      {children}
    </Column>
  )
}

/** A setting in the display panel: its name at the start and its control filling the rest. */
export function ReaderSetting({
  palette,
  label,
  children,
}: {
  palette: ReaderPalette
  label: string
  children: ReactNode
}) {
  return (
    <Row
      verticalAlignment='center'
      modifiers={[fillMaxWidth(), height(settingHeight), padding(0, 0, 12, 0)]}
    >
      <Box modifiers={[width(settingLabelWidth)]}>
        <Text color={palette.muted} maxLines={1} style={{ typography: 'bodyMedium' }}>
          {label}
        </Text>
      </Box>
      <Box contentAlignment='centerEnd' modifiers={[weight(1)]}>
        {children}
      </Box>
    </Row>
  )
}

/** One choice of a setting: a word, or an icon with the word for TalkBack. */
export type ReaderChoice<T> = { key: T; label: string; glyph?: Glyph }

/** A setting's choices side by side in a track, the chosen one filled. */
export function ReaderChoices<T extends string | number>({
  palette,
  choices,
  selected,
  onSelect,
}: {
  palette: ReaderPalette
  choices: ReaderChoice<T>[]
  selected: T
  onSelect: (key: T) => void
}) {
  return (
    <Row
      horizontalArrangement={{ spacedBy: 2 }}
      modifiers={[
        fillMaxWidth(),
        height(choicesHeight),
        clip(composeGeometry.RoundedCorner(choicesHeight / 2)),
        background(palette.track),
        padding(2, 2, 2, 2),
        selectableGroup(),
      ]}
    >
      {choices.map((choice) => {
        const chosen = choice.key === selected
        const tint = chosen ? palette.onChosen : palette.onSurface

        return (
          <Box
            key={String(choice.key)}
            contentAlignment='center'
            modifiers={[
              weight(1),
              fillMaxHeight(),
              clip(composeGeometry.RoundedCorner(choicesHeight / 2 - 2)),
              background(chosen ? palette.chosen : '#00000000'),
              selectable(chosen, () => onSelect(choice.key), 'radioButton'),
            ]}
          >
            {choice.glyph ? (
              <Icon
                source={glyphs[choice.glyph]}
                size={20}
                tint={tint}
                contentDescription={choice.label}
              />
            ) : (
              <Text color={tint} maxLines={1} style={{ typography: 'labelLarge' }}>
                {choice.label}
              </Text>
            )}
          </Box>
        )
      })}
    </Row>
  )
}

/** The text size between buttons that make it smaller and larger. */
export function ReaderTextSize({
  palette,
  value,
  labels,
  canShrink,
  canGrow,
  onShrink,
  onGrow,
}: {
  palette: ReaderPalette
  /** The size as shown, such as “100 %”. */
  value: string
  labels: { smaller: string; larger: string }
  canShrink: boolean
  canGrow: boolean
  onShrink: () => void
  onGrow: () => void
}) {
  return (
    <Row
      verticalAlignment='center'
      modifiers={[
        fillMaxWidth(),
        height(choicesHeight),
        clip(composeGeometry.RoundedCorner(choicesHeight / 2)),
        background(palette.track),
      ]}
    >
      {/* Handlers are guarded rather than the buttons disabled, as elsewhere in the app. */}
      <Box
        contentAlignment='center'
        modifiers={[
          size(48, choicesHeight),
          clip(composeGeometry.RoundedCorner(choicesHeight / 2)),
          clickable(() => canShrink && onShrink()),
        ]}
      >
        <Icon
          source={glyphs.textSmaller}
          size={20}
          tint={canShrink ? palette.onSurface : palette.muted}
          contentDescription={labels.smaller}
        />
      </Box>
      <Box contentAlignment='center' modifiers={[weight(1)]}>
        <Text color={palette.onSurface} maxLines={1} style={{ typography: 'labelLarge' }}>
          {value}
        </Text>
      </Box>
      <Box
        contentAlignment='center'
        modifiers={[
          size(48, choicesHeight),
          clip(composeGeometry.RoundedCorner(choicesHeight / 2)),
          clickable(() => canGrow && onGrow()),
        ]}
      >
        <Icon
          source={glyphs.textLarger}
          size={20}
          tint={canGrow ? palette.onSurface : palette.muted}
          contentDescription={labels.larger}
        />
      </Box>
    </Row>
  )
}
