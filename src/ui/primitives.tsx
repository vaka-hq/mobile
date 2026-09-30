import { useLingui } from '@lingui/react/macro'
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  alpha,
  animateContentSize,
  background,
  clickable,
  clip,
  combinedClickable,
  composeGeometry,
  fillMaxSize,
  fillMaxWidth,
  height,
  onVisibilityChanged,
  padding,
  paddingAll,
  size,
  toggleable,
  verticalScroll,
  weight,
} from '@/lib/compose-modifiers'
import {
  AnimatedVisibility,
  Box,
  Button,
  Card,
  Column,
  EnterTransition,
  ExitTransition,
  FilledTonalIconButton,
  FilterChip,
  FlowRow,
  Icon,
  IconButton,
  LazyColumn,
  LazyRow,
  LinearProgressIndicator,
  ListItem,
  LoadingIndicator,
  Row,
  Text,
  TextButton,
  TextField,
  type TextFieldRef,
  VerticalDivider,
  useMaterialColors,
  useNativeState,
} from '@/lib/compose-ui'
import {
  BodyCentre,
  ConnectedActions,
  ConnectedButtonGroup,
  CoverImage,
  FitColumn,
  GatedList,
  HeaderField,
  StepDots as NativeStepDots,
  TopAppBar,
  ViewportBox,
} from '../../modules/android-components'
import { type Glyph, glyphs, skipGlyph } from './glyphs'

export { PlayerFade, PlayPauseButton } from '../../modules/android-components'

/** A cover image with what the source knows about it before it loads. */
export type CoverArt = {
  uri: string | null
  /** Dominant colour, shown until the image fades in. */
  color?: string | null
  /** Width over height, so the placeholder already has the cover's shape. */
  aspect?: number | null
}

export type CoverProps = CoverArt & {
  /** The square slot in dp; the cover keeps its own proportions inside it. */
  dimension: number
  description?: string
  /** Inside the expanding player, covers with the same key travel between its two layouts. */
  sharedKey?: string
  /**
   * As large as the space it is given allows, in its own shape rather than a square slot; for a
   * cover fitted to the screen by `FitToScreen`. `dimension` then sizes only the stand-in.
   */
  fill?: boolean
}

/**
 * Book artwork at its own proportions with slightly rounded corners, centred in a square slot so
 * rows keep their layout while it loads; a book glyph stands in when there is none or it fails.
 */
export function Cover({ uri, color, aspect, dimension, description, sharedKey, fill }: CoverProps) {
  const colors = useMaterialColors()
  const [failed, setFailed] = useState<string | null>(null)
  // Book covers read as printed covers: only a slight softening of the corners.
  const radius = dimension >= 160 ? 12 : dimension >= 96 ? 8 : 4

  if (uri && failed !== uri) {
    return (
      <CoverImage
        uri={uri}
        description={description}
        dimension={dimension}
        cornerRadius={radius}
        color={color}
        aspect={aspect}
        sharedKey={sharedKey}
        hug={fill}
        fill={fill}
        onError={() => setFailed(uri)}
      />
    )
  }

  return (
    <Box
      contentAlignment='center'
      modifiers={[
        size(dimension, dimension),
        clip(composeGeometry.RoundedCorner(radius)),
        background(colors.surfaceContainerHighest),
      ]}
    >
      <Icon
        source={glyphs.book}
        size={Math.round(dimension * 0.4)}
        tint={colors.onSurfaceVariant}
        contentDescription={description}
      />
    </Box>
  )
}

/** A vertically scrolling list owning the screen body; every child is one lazy item. */
export type ListProps = {
  children: ReactNode
  bottomPadding?: number
  /** Card groups inset from the screen edges, as in settings. */
  grouped?: boolean
  /** One set of connected cards inset from the screen edges, as in a sheet's list. */
  cards?: boolean
  /** The first load: a loader centred in the whole body instead of the list. */
  loading?: boolean
  /** Tells `FitToScreen` items how tall the list shows, so they fit its first screen. */
  fitsViewport?: boolean
  /**
   * Under a screen's `header`: the header slides away only when the content overflows, so a list
   * that fits does not scroll, and overflowing content passes fully under it.
   */
  underHeader?: boolean
}

/** A grouped list's padding above its first item, and the space between its items, in dp. */
export const groupedListTop = 8

export const groupedListGap = 20

/** A vertically scrolling list owning the screen body; every child is one lazy item. */
export function List({
  children,
  bottomPadding = 16,
  grouped = false,
  cards = false,
  loading = false,
  fitsViewport = false,
  underHeader = false,
}: ListProps) {
  if (loading) {
    return <LoadingPage />
  }

  if (underHeader) {
    return (
      <GatedList
        contentPadding={
          grouped
            ? { start: 16, end: 16, top: groupedListTop, bottom: Math.max(bottomPadding, 32) }
            : cards
              ? { start: 16, end: 16, top: 8, bottom: bottomPadding }
              : { top: 4, bottom: bottomPadding }
        }
        spacing={grouped ? groupedListGap : cards ? 2 : 0}
      >
        {children}
      </GatedList>
    )
  }

  const list = (
    <LazyColumn
      modifiers={[fillMaxSize()]}
      contentPadding={
        grouped
          ? { start: 16, end: 16, top: groupedListTop, bottom: Math.max(bottomPadding, 32) }
          : cards
            ? { start: 16, end: 16, top: 8, bottom: bottomPadding }
            : { top: 4, bottom: bottomPadding }
      }
      verticalArrangement={
        grouped ? { spacedBy: groupedListGap } : cards ? { spacedBy: 2 } : undefined
      }
    >
      {children}
    </LazyColumn>
  )

  return fitsViewport ? <ViewportBox>{list}</ViewportBox> : list
}

/**
 * The first screen of a page in a `fitsViewport` list: its first child, such as a cover, takes
 * the height the others leave, so the whole group shows as the page opens, 16 dp above the mini
 * player or the navigation bar. Laid out natively in one pass, so nothing shifts as it appears.
 */
export function FitToScreen({ children }: { children: ReactNode }) {
  return (
    <FitColumn gap={groupedListGap} top={groupedListTop} clearance={16} minFirst={160}>
      {children}
    </FitColumn>
  )
}

export type GroupRow = {
  key: string
  label: string
  /** One short line; rows without it stay single-line with the glyph centred. */
  value?: string
  glyph?: Glyph
  /**
   * A small mark after the text, such as a download already cached; `warning` draws it in red.
   * With `drillIn` it sits before the chevron.
   */
  badge?: { glyph: Glyph; description: string; warning?: boolean }
  /** The chosen row of a single-choice group, drawn in the secondary container colour. */
  selected?: boolean
  /** A trailing chevron: the row opens a screen where its value can be changed. */
  drillIn?: boolean
  /** A trailing button with its own action, such as cancelling a download; replaces the badge. */
  action?: { glyph: Glyph; description: string; onPress: () => void }
  /** Something about the row is still being found out: a small spinner at its end. */
  pending?: boolean
  /** Shown faded and not tappable, such as a choice that is still being checked. */
  disabled?: boolean
  onPress?: () => void
  /** Held down, such as to show more about the row; works while disabled too. */
  onLongPress?: () => void
}

/** Where a row sits in a run of card rows: the run's outer corners are round, its joins tight. */
export type CardPosition = {
  index: number
  count: number
  /** Something connected sits directly above, so even the first row's top joins tightly. */
  joinedAbove?: boolean
}

function cardCorners({ index, count, joinedAbove = false }: CardPosition) {
  const top = index === 0 && !joinedAbove ? 20 : 4
  const bottom = index === count - 1 ? 20 : 4

  return composeGeometry.RoundedCorner({
    topStart: top,
    topEnd: top,
    bottomStart: bottom,
    bottomEnd: bottom,
  })
}

/** Material's opacity for disabled content. */
const disabledAlpha = 0.38

/** A group row's tap and hold; a disabled row only answers the hold. */
function rowGestures(row: GroupRow) {
  const onClick = row.disabled ? undefined : row.onPress

  if (row.onLongPress) {
    return [combinedClickable({ onClick, onLongClick: row.onLongPress })]
  }

  return onClick ? [clickable(onClick)] : []
}

function GroupTitle({ title }: { title: string }) {
  const colors = useMaterialColors()

  return (
    <Text
      color={colors.primary}
      modifiers={[padding(4, 0, 4, 0)]}
      style={{ typography: 'titleSmall' }}
    >
      {title}
    </Text>
  )
}

/**
 * A titled group of connected card rows: the group's outer corners are round, the joins between
 * rows are tight, like Material settings lists. Rows that arrive later grow the group smoothly.
 */
export function Group({
  title,
  caption,
  rows,
  joinedAbove = false,
}: {
  title?: string
  /** One line under the title describing the whole group. */
  caption?: string | null
  rows: GroupRow[]
  /** The rows continue something connected above them, such as a pair of actions. */
  joinedAbove?: boolean
}) {
  const colors = useMaterialColors()

  return (
    <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
      {title || caption ? (
        <Column modifiers={[fillMaxWidth()]}>
          {title ? <GroupTitle title={title} /> : null}
          {caption ? (
            <Text
              color={colors.onSurfaceVariant}
              modifiers={[padding(4, 0, 4, 0)]}
              style={{ typography: 'bodySmall' }}
            >
              {caption}
            </Text>
          ) : null}
        </Column>
      ) : null}
      <Column
        modifiers={[fillMaxWidth(), animateContentSize()]}
        verticalArrangement={{ spacedBy: 2 }}
      >
        {rows.map((row, index) => {
          return (
            <ListItem
              // Compose reads a ListItem's slots once, so a row that gains or loses a line or a
              // trailing mark, such as a value that loads later, is drawn afresh.
              key={`${row.key}:${row.value ? 'v' : ''}${row.badge ? 'b' : ''}${row.drillIn ? 'd' : ''}${row.action ? 'a' : ''}${row.pending ? 'p' : ''}`}
              colors={{
                containerColor: row.selected
                  ? colors.secondaryContainer
                  : colors.surfaceContainerHigh,
              }}
              modifiers={[
                fillMaxWidth(),
                clip(cardCorners({ index, count: rows.length, joinedAbove })),
                ...rowGestures(row),
              ]}
            >
              {row.glyph ? (
                <ListItem.LeadingContent>
                  <Icon source={glyphs[row.glyph]} size={24} tint={colors.onSurfaceVariant} />
                </ListItem.LeadingContent>
              ) : null}
              <ListItem.HeadlineContent>
                {/* Two lines at most, so a long name such as a whole cast never grows the card. */}
                <Text
                  maxLines={2}
                  overflow='ellipsis'
                  modifiers={row.disabled ? [alpha(disabledAlpha)] : []}
                >
                  {row.label}
                </Text>
              </ListItem.HeadlineContent>
              {row.value ? (
                <ListItem.SupportingContent>
                  <Text
                    color={colors.onSurfaceVariant}
                    maxLines={1}
                    overflow='ellipsis'
                    modifiers={row.disabled ? [alpha(disabledAlpha)] : []}
                  >
                    {row.value}
                  </Text>
                </ListItem.SupportingContent>
              ) : null}
              {row.drillIn && !row.action ? (
                <ListItem.TrailingContent>
                  {/* A badge sits before the chevron, such as a recording kept on the phone. */}
                  <Row verticalAlignment='center' horizontalArrangement={{ spacedBy: 8 }}>
                    {row.badge ? (
                      <Icon
                        source={glyphs[row.badge.glyph]}
                        size={20}
                        tint={row.badge.warning ? colors.error : colors.primary}
                        contentDescription={row.badge.description}
                      />
                    ) : null}
                    <Icon source={glyphs.drillIn} size={24} tint={colors.onSurfaceVariant} />
                  </Row>
                </ListItem.TrailingContent>
              ) : null}
              {row.pending ? (
                <ListItem.TrailingContent>
                  {/* The app's loading indicator, as on every page still loading. */}
                  <LoadingIndicator modifiers={[size(32, 32)]} />
                </ListItem.TrailingContent>
              ) : row.action ? (
                <ListItem.TrailingContent>
                  <IconButton onClick={row.action.onPress}>
                    <Icon
                      source={glyphs[row.action.glyph]}
                      size={24}
                      tint={colors.onSurfaceVariant}
                      contentDescription={row.action.description}
                    />
                  </IconButton>
                </ListItem.TrailingContent>
              ) : row.badge && !row.drillIn ? (
                <ListItem.TrailingContent>
                  <Icon
                    source={glyphs[row.badge.glyph]}
                    size={20}
                    tint={row.badge.warning ? colors.error : colors.primary}
                    contentDescription={row.badge.description}
                  />
                </ListItem.TrailingContent>
              ) : null}
            </ListItem>
          )
        })}
      </Column>
    </Column>
  )
}

export type BookRowProps = {
  title: string
  subtitle?: string | null
  detail?: string | null
  coverUri: string | null
  coverColor?: string | null
  coverAspect?: number | null
  /** Listening progress from 0 to 1, drawn beneath the text when started. */
  progress?: number | null
  trailing?: ReactNode
  /** Draws the row as part of a card run, inset from the screen edges like settings groups. */
  card?: CardPosition
  /** The current one of the list, such as the book playing, in the secondary container colour. */
  selected?: boolean
  onPress: () => void
  /** Held down, the row does this instead, such as opening its menu. */
  onLongPress?: () => void
}

export function BookRow({
  title,
  subtitle,
  detail,
  coverUri,
  coverColor,
  coverAspect,
  progress,
  trailing,
  card,
  selected = false,
  onPress,
  onLongPress,
}: BookRowProps) {
  const colors = useMaterialColors()
  const supporting = selected ? colors.onSecondaryContainer : colors.onSurfaceVariant

  const container = selected
    ? colors.secondaryContainer
    : card
      ? colors.surfaceContainerHigh
      : colors.surface

  // A row rather than a ListItem: Material pins three-line items to the top of a tall cover, and
  // book details read better centred beside it.
  const item = (
    <Row
      verticalAlignment='center'
      horizontalArrangement={{ spacedBy: 16 }}
      modifiers={[
        fillMaxWidth(),
        ...(card ? [clip(cardCorners(card))] : []),
        background(container),
        onLongPress
          ? combinedClickable({ onClick: onPress, onLongClick: onLongPress })
          : clickable(onPress),
        padding(16, 12, trailing ? 12 : 16, 12),
      ]}
    >
      <Cover uri={coverUri} color={coverColor} aspect={coverAspect} dimension={80} />
      {/* The title and who wrote it read as one, a little apart from what is left of the book. */}
      <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 6 }}>
        <Column>
          <Text maxLines={2} overflow='ellipsis' style={{ typography: 'titleMedium' }}>
            {title}
          </Text>
          {subtitle ? (
            <Text maxLines={1} overflow='ellipsis' color={supporting}>
              {subtitle}
            </Text>
          ) : null}
        </Column>
        {detail ? (
          <Text
            maxLines={1}
            overflow='ellipsis'
            color={supporting}
            style={{ typography: 'bodySmall' }}
          >
            {detail}
          </Text>
        ) : null}
        {/* Under 1% the bar is only its two end dots, which read as stray marks. */}
        {progress && progress >= 0.01 ? (
          <LinearProgressIndicator
            progress={Math.min(1, Math.max(0, progress))}
            // The default track is the selected row's own colour.
            trackColor={selected ? colors.surface : colors.secondaryContainer}
            modifiers={[fillMaxWidth(), padding(0, 4, 0, 0)]}
          />
        ) : null}
      </Column>
      {trailing}
    </Row>
  )

  // Rows of one card sit 2 dp apart, the same join as settings groups.
  return card ? <Box modifiers={[fillMaxWidth(), padding(16, 1, 16, 1)]}>{item}</Box> : item
}

/** Marks the row that is the current choice in a list of options, at a row's trailing end. */
export function ChosenMark() {
  const colors = useMaterialColors()

  return <Icon source={glyphs.check} size={24} tint={colors.primary} />
}

/**
 * A round tonal play or pause button at the end of a row, such as resuming a book from the
 * library without opening it. On a selected row it fills with the primary colour, since the
 * tonal one would vanish into the row.
 */
export function PlayToggle({
  playing,
  label,
  selected = false,
  onPress,
}: {
  playing: boolean
  /** Spoken, naming what the button plays or pauses. */
  label: string
  /** The row it sits on is selected. */
  selected?: boolean
  onPress: () => void
}) {
  return (
    <RowButton
      glyph={playing ? 'pause' : 'play'}
      label={label}
      selected={selected}
      onPress={onPress}
    />
  )
}

/** The same round tonal button, opening a book to read from where reading stopped. */
export function ReadButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <RowButton glyph='read' label={label} selected={false} onPress={onPress} />
}

function RowButton({
  glyph,
  label,
  selected,
  onPress,
}: {
  glyph: Glyph
  label: string
  selected: boolean
  onPress: () => void
}) {
  const colors = useMaterialColors()

  return (
    <FilledTonalIconButton
      onClick={onPress}
      // Always set: Expo UI cannot return a button's colours to their defaults.
      colors={
        selected
          ? { containerColor: colors.primary, contentColor: colors.onPrimary }
          : { containerColor: colors.secondaryContainer, contentColor: colors.onSecondaryContainer }
      }
      modifiers={[size(48, 48)]}
    >
      <Icon source={glyphs[glyph]} size={24} contentDescription={label} />
    </FilledTonalIconButton>
  )
}

/** One of the app's glyphs in the colour of the slot it sits in, such as a card's trailing mark. */
export function GlyphIcon({ glyph, size: dimension = 24 }: { glyph: Glyph; size?: number }) {
  return <Icon source={glyphs[glyph]} size={dimension} />
}

/**
 * Which step of a short sequence is showing: a dot for each, the current one a long pill in the
 * primary colour that glides onto the next dot, or back, as the step changes.
 */
export function StepDots({ count, current }: { count: number; current: number }) {
  return <NativeStepDots count={count} current={current} />
}

/** The head of a setup step: its icon in a tonal circle, its title and a short line under it. */
export function IntroHeader({
  glyph,
  title,
  message,
}: {
  glyph: Glyph
  title: string
  message?: string
}) {
  const colors = useMaterialColors()

  return (
    <Column horizontalAlignment='center' verticalArrangement={{ spacedBy: 16 }}>
      <Box
        contentAlignment='center'
        modifiers={[
          size(96, 96),
          clip(composeGeometry.Circle),
          background(colors.primaryContainer),
        ]}
      >
        <Icon source={glyphs[glyph]} size={48} tint={colors.onPrimaryContainer} />
      </Box>
      <Text style={{ typography: 'headlineSmall', textAlign: 'center' }}>{title}</Text>
      {message ? (
        <Text
          color={colors.onSurfaceVariant}
          style={{ typography: 'bodyLarge', textAlign: 'center' }}
        >
          {message}
        </Text>
      ) : null}
    </Column>
  )
}

/** A licence or other long plain text in a sheet, scrolling within it. */
export function LicenseText({ text }: { text: string }) {
  const colors = useMaterialColors()

  return (
    <Column modifiers={[fillMaxWidth(), verticalScroll(), padding(24, 0, 24, 32)]}>
      <Text color={colors.onSurfaceVariant} style={{ typography: 'bodySmall' }}>
        {text}
      </Text>
    </Column>
  )
}

export type CardRowProps = {
  title: string
  subtitle?: string | null
  detail?: string | null
  card: CardPosition
  onPress: () => void
}

/** A card row for things without a cover, such as a series, matching `BookRow` cards. */
export function CardRow({ title, subtitle, detail, card, onPress }: CardRowProps) {
  const colors = useMaterialColors()

  return (
    <Box modifiers={[fillMaxWidth(), padding(16, 1, 16, 1)]}>
      <ListItem
        colors={{ containerColor: colors.surfaceContainerHigh }}
        modifiers={[fillMaxWidth(), clip(cardCorners(card)), clickable(onPress)]}
      >
        <ListItem.HeadlineContent>
          <Text maxLines={2} overflow='ellipsis' style={{ typography: 'titleMedium' }}>
            {title}
          </Text>
        </ListItem.HeadlineContent>
        {subtitle || detail ? (
          <ListItem.SupportingContent>
            <Column verticalArrangement={{ spacedBy: 4 }}>
              {subtitle ? (
                <Text maxLines={1} overflow='ellipsis' color={colors.onSurfaceVariant}>
                  {subtitle}
                </Text>
              ) : null}
              {detail ? (
                <Text
                  maxLines={1}
                  overflow='ellipsis'
                  color={colors.onSurfaceVariant}
                  style={{ typography: 'bodySmall' }}
                >
                  {detail}
                </Text>
              ) : null}
            </Column>
          </ListItem.SupportingContent>
        ) : null}
      </ListItem>
    </Box>
  )
}

export type SpringAction = {
  glyph: Glyph
  label: string
  enabled?: boolean
  /** One of the page's main actions, filled in the primary colour; otherwise tonal. */
  primary?: boolean
  /** A tonal action that is switched on, such as a book already in the library. */
  selected?: boolean
  /** Only the icon shows; the label is read out by accessibility services. */
  iconOnly?: boolean
  onPress: () => void
}

/**
 * A page's main actions as connected buttons that spring on press: the primary ones filled and
 * sharing the width, the others tonal, turning to the primary container while selected.
 */
export function SpringActions({
  actions,
  rows = [],
}: {
  actions: SpringAction[]
  /** Card rows joined directly beneath the buttons, reading as one group with them. */
  rows?: GroupRow[]
}) {
  const buttons = (
    <ConnectedActions
      actions={actions.map((action, index) => ({
        // By place: an action keeps its button while its label and icon change.
        key: String(index),
        label: action.label,
        icon: <Icon source={glyphs[action.glyph]} size={20} />,
        enabled: action.enabled,
        filled: action.primary,
        selected: action.selected,
        iconOnly: action.iconOnly,
        onPress: action.onPress,
      }))}
      joinedBelow={rows.length > 0}
    />
  )

  return rows.length > 0 ? (
    <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 2 }}>
      {buttons}
      <Group rows={rows} joinedAbove />
    </Column>
  ) : (
    buttons
  )
}

/**
 * Long text in a standard card that expands in place when tapped; the card's ripple reaches its
 * edges and the growth eases in. With a summary, the card first shows only the summary and adds
 * the full text below it when expanded.
 */
export function ExpandableTextCard({
  title,
  summary,
  text,
  collapsedLines = 6,
}: {
  title?: string
  /** A short opening shown on its own until the card is expanded, such as a book's headline. */
  summary?: string | null
  text: string
  collapsedLines?: number
}) {
  const colors = useMaterialColors()
  const [expanded, setExpanded] = useState(false)
  const expandable = Boolean(summary) || text.length > 320

  const card = (
    <Card
      colors={{ containerColor: colors.surfaceContainerHigh }}
      modifiers={[
        fillMaxWidth(),
        clip(composeGeometry.RoundedCorner(20)),
        ...(expandable ? [clickable(() => setExpanded(!expanded))] : []),
      ]}
    >
      <Column
        modifiers={[fillMaxWidth(), padding(16, 16, 16, 16), animateContentSize()]}
        verticalArrangement={{ spacedBy: 12 }}
      >
        {summary ? (
          <Text style={{ typography: 'bodyMedium' }} modifiers={[fillMaxWidth()]}>
            {summary}
          </Text>
        ) : null}
        {!summary || expanded ? (
          <Text
            maxLines={expanded || !expandable ? undefined : collapsedLines}
            overflow='ellipsis'
            style={{ typography: 'bodyMedium' }}
            modifiers={[fillMaxWidth()]}
          >
            {text}
          </Text>
        ) : null}
      </Column>
    </Card>
  )

  return title ? (
    <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
      <GroupTitle title={title} />
      {card}
    </Column>
  ) : (
    card
  )
}

export type Stat = {
  key: string
  value: string
  label: string
}

/** A few headline facts side by side in one card, each a large value over a short label. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const colors = useMaterialColors()

  return (
    <Row
      modifiers={[
        fillMaxWidth(),
        clip(composeGeometry.RoundedCorner(20)),
        background(colors.surfaceContainerHigh),
        padding(8, 16, 8, 16),
        animateContentSize(),
      ]}
    >
      {stats.map((stat) => (
        <Column
          key={stat.key}
          horizontalAlignment='center'
          verticalArrangement={{ spacedBy: 2 }}
          modifiers={[weight(1)]}
        >
          <Text style={{ typography: 'titleMedium' }} maxLines={1} overflow='ellipsis'>
            {stat.value}
          </Text>
          <Text
            color={colors.onSurfaceVariant}
            style={{ typography: 'bodySmall' }}
            maxLines={1}
            overflow='ellipsis'
          >
            {stat.label}
          </Text>
        </Column>
      ))}
    </Row>
  )
}

/** A titled set of labels that wrap onto new lines, such as a book's genres. */
export function TagGroup({ title, tags }: { title: string; tags: string[] }) {
  const colors = useMaterialColors()

  return (
    <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
      <GroupTitle title={title} />
      <FlowRow
        modifiers={[fillMaxWidth()]}
        horizontalArrangement={{ spacedBy: 8 }}
        verticalArrangement={{ spacedBy: 8 }}
      >
        {tags.map((tag) => (
          <Text
            key={tag}
            color={colors.onSurfaceVariant}
            style={{ typography: 'labelLarge' }}
            modifiers={[
              clip(composeGeometry.RoundedCorner(8)),
              background(colors.surfaceContainerHigh),
              padding(12, 6, 12, 6),
            ]}
          >
            {tag}
          </Text>
        ))}
      </FlowRow>
    </Column>
  )
}

export type InfoRowProps = {
  label: string
  value: string
  glyph?: Glyph
  onPress?: () => void
  trailing?: ReactNode
}

/** A label over its value, optionally tappable, for settings and book facts. */
export function InfoRow({ label, value, glyph, onPress, trailing }: InfoRowProps) {
  const colors = useMaterialColors()

  return (
    <ListItem
      colors={{ containerColor: colors.surface }}
      modifiers={onPress ? [clickable(onPress)] : []}
    >
      {glyph ? (
        <ListItem.LeadingContent>
          <Icon source={glyphs[glyph]} size={24} tint={colors.onSurfaceVariant} />
        </ListItem.LeadingContent>
      ) : null}
      <ListItem.HeadlineContent>
        <Text>{label}</Text>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Text color={colors.onSurfaceVariant}>{value}</Text>
      </ListItem.SupportingContent>
      {trailing ? <ListItem.TrailingContent>{trailing}</ListItem.TrailingContent> : null}
    </ListItem>
  )
}

/**
 * The loader for a body that has nothing to show yet, centred where `Empty` fills the body. Use in
 * place of a list: items inside a lazy list cannot fill its height.
 */
export function LoadingPage() {
  return (
    <BodyCentre>
      <LoadingIndicator modifiers={[size(48, 48)]} />
    </BodyCentre>
  )
}

/** An inline loader inside a list that already shows something, such as more results. */
export function Loading() {
  return (
    <Box contentAlignment='center' modifiers={[fillMaxWidth(), paddingAll(32)]}>
      <LoadingIndicator modifiers={[size(48, 48)]} />
    </Box>
  )
}

export type EmptyProps = {
  glyph: Glyph
  title: string
  message?: string
  /**
   * Centred in this height in dp, such as the visible part of a sheet, or in the whole screen body
   * with `fill`, instead of from the top.
   */
  height?: number | 'fill'
  actionLabel?: string
  onAction?: () => void
}

export function Empty({ glyph, title, message, height: fixed, actionLabel, onAction }: EmptyProps) {
  const colors = useMaterialColors()

  const content = (
    <Column
      horizontalAlignment='center'
      verticalArrangement={{ spacedBy: 12 }}
      modifiers={[
        fillMaxWidth(),
        fixed === undefined ? padding(32, 48, 32, 32) : padding(32, 0, 32, 0),
      ]}
    >
      <Icon source={glyphs[glyph]} size={48} tint={colors.onSurfaceVariant} />
      <Text style={{ typography: 'titleLarge', textAlign: 'center' }}>{title}</Text>
      {message ? (
        <Text
          color={colors.onSurfaceVariant}
          style={{ typography: 'bodyMedium', textAlign: 'center' }}
        >
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button onClick={onAction} modifiers={[padding(0, 8, 0, 0)]}>
          <Text>{actionLabel}</Text>
        </Button>
      ) : null}
    </Column>
  )

  if (fixed === undefined) {
    return content
  }

  // Filling the body, it stays centred in what the keyboard leaves of it, as while searching.
  return fixed === 'fill' ? (
    <BodyCentre>{content}</BodyCentre>
  ) : (
    <Box contentAlignment='center' modifiers={[fillMaxWidth(), height(fixed)]}>
      {content}
    </Box>
  )
}

export type NoticeProps = {
  glyph: Glyph
  message: string
  actionLabel?: string
  onAction?: () => void
  tone?: 'neutral' | 'error'
}

/** An inline message inside a screen, such as a failed request with its retry. */
export function Notice({ glyph, message, actionLabel, onAction, tone = 'neutral' }: NoticeProps) {
  const colors = useMaterialColors()
  const container = tone === 'error' ? colors.errorContainer : colors.surfaceContainerHigh
  const content = tone === 'error' ? colors.onErrorContainer : colors.onSurfaceVariant

  return (
    <Box modifiers={[fillMaxWidth(), padding(16, 8, 16, 8)]}>
      <ListItem
        colors={{ containerColor: container, contentColor: content }}
        modifiers={[fillMaxWidth(), clip(composeGeometry.RoundedCorner(16))]}
      >
        <ListItem.LeadingContent>
          <Icon source={glyphs[glyph]} size={24} tint={content} />
        </ListItem.LeadingContent>
        <ListItem.HeadlineContent>
          <Text color={content} style={{ typography: 'bodyMedium' }}>
            {message}
          </Text>
        </ListItem.HeadlineContent>
        {actionLabel && onAction ? (
          <ListItem.TrailingContent>
            <TextButton onClick={onAction}>
              <Text>{actionLabel}</Text>
            </TextButton>
          </ListItem.TrailingContent>
        ) : null}
      </ListItem>
    </Box>
  )
}

/**
 * The foot of a list that loads page by page, a spinner saying more is coming: while any of it is
 * on screen and nothing is loading, it asks for the next page, again after each page arrives, so
 * it never waits on a scroll that cannot come, such as when it was already showing as a load
 * finished. The spinner is always there; an empty foot is never reported as seen.
 */
export function LoadMore({ loading, onVisible }: { loading: boolean; onVisible: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (visible && !loading) {
      onVisible()
    }
  })

  return (
    <Box
      contentAlignment='center'
      modifiers={[
        fillMaxWidth(),
        paddingAll(16),
        onVisibilityChanged(setVisible, { minFractionVisible: 0.01 }),
      ]}
    >
      <LoadingIndicator modifiers={[size(40, 40)]} />
    </Box>
  )
}

/** A chip that opens a filter's choices; it reads as chosen while the filter narrows anything. */
export type FilterChoice = {
  label: string
  selected: boolean
  onPress: () => void
}

function FilterDropdownChip({
  label,
  selected,
  onPress,
  iconOnly = false,
}: FilterChoice & {
  /** Shows the sort glyph in place of the label, which is still spoken. */
  iconOnly?: boolean
}) {
  return (
    <FilterChip selected={selected} onClick={onPress} modifiers={[animateContentSize()]}>
      <FilterChip.Label>
        <Box modifiers={[animateContentSize()]}>
          {iconOnly ? (
            <Icon source={glyphs.sort} size={20} contentDescription={label} />
          ) : (
            <Text maxLines={1}>{label}</Text>
          )}
        </Box>
      </FilterChip.Label>
      <FilterChip.TrailingIcon>
        <Icon source={glyphs.collapse} size={18} />
      </FilterChip.TrailingIcon>
    </FilterChip>
  )
}

/**
 * A row of filter chips as the reference app has it: the sort chip first, a divider, then one chip
 * per filter, each opening its choices. Chips ease to the width of their labels.
 */
export function FilterBar({ sort, filters }: { sort: FilterChoice; filters: FilterChoice[] }) {
  return (
    <LazyRow
      modifiers={[fillMaxWidth()]}
      // Right under the title row above it, with a little room below before the list.
      contentPadding={{ start: 16, end: 16, top: 0, bottom: 4 }}
      horizontalArrangement={{ spacedBy: 8 }}
      verticalAlignment='center'
    >
      <FilterDropdownChip {...sort} iconOnly />
      <VerticalDivider modifiers={[size(1, 20)]} />
      {filters.map((filter, index) => (
        // Keyed by place, so a chip keeps its identity and animates when its label changes.
        <FilterDropdownChip key={index} {...filter} />
      ))}
    </LazyRow>
  )
}

export type ChoiceChip = {
  key: string
  label: string
}

export function ChipRow({
  chips,
  selected,
  onSelect,
}: {
  chips: ChoiceChip[]
  selected: string
  onSelect: (key: string) => void
}) {
  return (
    <LazyRow
      horizontalArrangement={{ spacedBy: 8 }}
      // The field above leaves 4 dp more, so the body starts as far below as the field sits above.
      contentPadding={{ start: 16, end: 16, top: 4, bottom: 8 }}
      modifiers={[fillMaxWidth()]}
    >
      {chips.map((chip) => (
        <FilterChip
          key={chip.key}
          selected={chip.key === selected}
          onClick={() => onSelect(chip.key)}
        >
          <FilterChip.Label>
            <Text>{chip.label}</Text>
          </FilterChip.Label>
        </FilterChip>
      ))}
    </LazyRow>
  )
}

/** Lets go of the field's focus, which puts the keyboard away; resolves once it has. */
export type SearchFieldHandle = { blur: () => Promise<void> }

export type SearchFieldProps = {
  ref?: Ref<SearchFieldHandle>
  initialValue: string
  placeholder: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  /** Focused as soon as it shows, with the keyboard up. */
  autoFocus?: boolean
  /** An action beside the field, such as the way to Settings when the field stands in the title. */
  trailing?: ReactNode
  /** Chips follow, which add their own spacing, so the field leaves only a little. */
  beforeChips?: boolean
  /**
   * A back arrow before the field, in an app bar's navigation slot, for a search page of its own
   * where the bar is the page's top bar. The keyboard is put away before it is called.
   */
  onBack?: () => void
}

/** The native observable owns text and selection; JS only observes changes for searching. */
export function SearchField({
  ref,
  initialValue,
  placeholder,
  onChange,
  onSubmit,
  autoFocus = false,
  trailing,
  beforeChips = false,
  onBack,
}: SearchFieldProps) {
  const { t } = useLingui()
  const colors = useMaterialColors()
  const text = useNativeState(initialValue)
  const field = useRef<TextFieldRef>(null)
  const [hasText, setHasText] = useState(Boolean(initialValue))

  async function blur() {
    await field.current?.blur().catch(() => undefined)
  }

  useImperativeHandle(ref, () => ({ blur }))

  // The field's pill brightens with the header it sits in as content scrolls under that.
  const input = (
    <HeaderField>
      <TextField
        ref={field}
        value={text}
        autoFocus={autoFocus}
        singleLine
        maxLength={120}
        modifiers={[fillMaxWidth()]}
        textStyle={{ fontSize: 16 }}
        keyboardOptions={{ imeAction: 'search', autoCorrectEnabled: false }}
        keyboardActions={{
          onSearch: (value) => {
            onSubmit?.(value)
            void field.current?.blur()
          },
        }}
        colors={{
          focusedContainerColor: 'transparent',
          unfocusedContainerColor: 'transparent',
          focusedIndicatorColor: 'transparent',
          unfocusedIndicatorColor: 'transparent',
          focusedTextColor: colors.onSurface,
          unfocusedTextColor: colors.onSurface,
          focusedPlaceholderColor: colors.onSurfaceVariant,
          unfocusedPlaceholderColor: colors.onSurfaceVariant,
          focusedLeadingIconColor: colors.onSurfaceVariant,
          unfocusedLeadingIconColor: colors.onSurfaceVariant,
          focusedTrailingIconColor: colors.onSurfaceVariant,
          unfocusedTrailingIconColor: colors.onSurfaceVariant,
        }}
        onValueChange={(next) => {
          setHasText(Boolean(next))
          onChange(next)
        }}
      >
        <TextField.Placeholder>
          <Text>{placeholder}</Text>
        </TextField.Placeholder>
        <TextField.LeadingIcon>
          {/* Reserve the slot before Expo's asynchronous vector loader finishes. */}
          <Box modifiers={[size(48, 48)]} contentAlignment='center'>
            <Icon source={glyphs.search} size={24} />
          </Box>
        </TextField.LeadingIcon>
        <TextField.TrailingIcon>
          <Box modifiers={[size(48, 48)]} contentAlignment='center'>
            <AnimatedVisibility
              visible={hasText}
              enterTransition={EnterTransition.fadeIn()}
              exitTransition={ExitTransition.fadeOut()}
            >
              <IconButton
                onClick={() => {
                  void field.current?.clear()
                  // Imperative clear updates native state without emitting onValueChange.
                  setHasText(false)
                  onChange('')
                  // Cleared to type something else, so the field keeps the keyboard.
                  void field.current?.focus()
                }}
              >
                <Icon
                  source={glyphs.clear}
                  size={24}
                  contentDescription={t({
                    message: 'Clear search',
                    comment: 'Empties the search field',
                  })}
                />
              </IconButton>
            </AnimatedVisibility>
          </Box>
        </TextField.TrailingIcon>
      </TextField>
    </HeaderField>
  )

  // With a way back, the field is a page's top bar: the app's own top app bar, the arrow in its
  // navigation slot and the field as its title, so both sit where they do on every other screen.
  // The bar keeps clear of the status bar itself.
  return onBack ? (
    <TopAppBar
      title=''
      navigationIcon={
        <IconButton onClick={() => void blur().then(onBack)}>
          <Icon
            source={glyphs.back}
            size={24}
            contentDescription={t({
              message: 'Back',
              comment: 'Top bar button returning to the previous screen',
            })}
          />
        </IconButton>
      }
      titleContent={<Box modifiers={[fillMaxWidth(), padding(0, 0, 12, 0)]}>{input}</Box>}
    />
  ) : trailing ? (
    // In a top bar with an action, the field takes the title's place and the action its own. The
    // action is a filled button, so it keeps the field's margin from the edge and a gap from it.
    <Row
      verticalAlignment='center'
      horizontalArrangement={{ spacedBy: 4 }}
      modifiers={[fillMaxWidth(), padding(16, beforeChips ? 0 : 8, 12, 8)]}
    >
      <Box modifiers={[weight(1)]}>{input}</Box>
      {trailing}
    </Row>
  ) : (
    // Over chips, as in Browse's top bar, the field sits right under the status bar.
    <Box modifiers={[fillMaxWidth(), padding(16, beforeChips ? 0 : 8, 16, beforeChips ? 4 : 8)]}>
      {input}
    </Box>
  )
}

export type SkipIconProps = {
  direction: 'back' | 'forward'
  seconds: number
  /** The icon's size in dp. */
  dimension: number
  description: string
}

/** The skip control's icon: a circular arrow with the interval in its middle, as players show it. */
export function SkipIcon({ direction, seconds, dimension, description }: SkipIconProps) {
  return (
    <Icon
      source={glyphs[skipGlyph(direction, seconds)]}
      size={dimension}
      contentDescription={description}
    />
  )
}

export type GroupButton = {
  key: string
  glyph: Glyph
  label: string
  /** Spoken instead of the label where the label alone says too little. */
  description?: string
  /** Shows a setting that is on, such as a speed other than normal. */
  selected?: boolean
  onPress: () => void
  /** Held down, the button does this instead, with a spring and colour flash to confirm it. */
  onLongPress?: () => void
}

/**
 * A row of connected buttons, each an icon and a short label; a selected one fills in, as for a
 * setting that is switched on.
 */
export function ButtonGroup({ buttons }: { buttons: GroupButton[] }) {
  return (
    <ConnectedButtonGroup
      items={buttons.map((button) => ({
        key: button.key,
        label: button.label,
        description: button.description,
        checked: button.selected,
        icon: <Icon source={glyphs[button.glyph]} size={18} />,
        onPress: button.onPress,
        onLongPress: button.onLongPress,
      }))}
    />
  )
}

export type CardItemProps = {
  card: CardPosition
  /** The current one of the list, such as the chapter playing. */
  selected?: boolean
  /** A number or an icon in a fixed column before the text. */
  leading?: { text: string } | { glyph: Glyph }
  headline: string
  /** A part of the headline to mark, such as where a search matched, in characters. */
  highlight?: { start: number; length: number } | null
  /** How many lines the headline may take before it is cut short; two by default. */
  headlineLines?: number
  supporting?: string | null
  /** A short value at the end, such as a length. */
  detail?: string | null
  /** A control at the end instead of a value, such as a delete button. */
  action?: ReactNode
  /**
   * Makes the card one of a set of choices, with a checkmark while chosen. The mark is always
   * there and only shows or hides, since Compose reads a card's trailing slot once.
   */
  checked?: boolean
  /** Steps in from the start, such as a subsection under its chapter. */
  indent?: number
  /** Without it the card only shows information. */
  onPress?: () => void
}

/** One connected card of a list in a sheet; the list sets the spacing between cards. */
export function CardItem({
  card,
  selected = false,
  leading,
  headline,
  highlight,
  headlineLines = 2,
  supporting,
  detail,
  action,
  checked,
  indent = 0,
  onPress,
}: CardItemProps) {
  const colors = useMaterialColors()
  const onCard = selected ? colors.onSecondaryContainer : colors.onSurfaceVariant

  return (
    <ListItem
      colors={{
        containerColor: selected ? colors.secondaryContainer : colors.surfaceContainerHigh,
      }}
      modifiers={[
        fillMaxWidth(),
        clip(cardCorners(card)),
        // A row with a check reads to TalkBack as a checkbox, checked or not.
        ...(onPress
          ? [
              checked === undefined
                ? clickable(onPress)
                : toggleable(checked, onPress, { role: 'checkbox' }),
            ]
          : []),
      ]}
    >
      {leading ? (
        <ListItem.LeadingContent>
          {/* A fixed column keeps titles aligned across one- and two-digit numbers. */}
          <Box contentAlignment='center' modifiers={[size(32, 32)]}>
            {'glyph' in leading ? (
              <Icon source={glyphs[leading.glyph]} size={24} tint={onCard} />
            ) : (
              <Text color={onCard} style={{ typography: 'labelLarge' }}>
                {leading.text}
              </Text>
            )}
          </Box>
        </ListItem.LeadingContent>
      ) : null}
      <ListItem.HeadlineContent>
        <Text
          maxLines={headlineLines}
          overflow='ellipsis'
          modifiers={indent > 0 ? [padding(indent * 16, 0, 0, 0)] : []}
        >
          {highlight && highlight.start + highlight.length <= headline.length
            ? // Spans are read from the text's direct children, so they go in as a list.
              [
                headline.slice(0, highlight.start),
                <Text
                  key='highlight'
                  color={colors.onPrimaryContainer}
                  style={{ background: colors.primaryContainer, fontWeight: '600' }}
                >
                  {headline.slice(highlight.start, highlight.start + highlight.length)}
                </Text>,
                headline.slice(highlight.start + highlight.length),
              ]
            : headline}
        </Text>
      </ListItem.HeadlineContent>
      {supporting ? (
        <ListItem.SupportingContent>
          <Text color={onCard} maxLines={1} overflow='ellipsis'>
            {supporting}
          </Text>
        </ListItem.SupportingContent>
      ) : null}
      {checked !== undefined ? (
        <ListItem.TrailingContent>
          <Icon source={glyphs.check} size={24} tint={checked ? onCard : 'transparent'} />
        </ListItem.TrailingContent>
      ) : action || detail ? (
        <ListItem.TrailingContent>
          {action ?? (
            <Text color={onCard} style={{ typography: 'labelMedium' }}>
              {detail}
            </Text>
          )}
        </ListItem.TrailingContent>
      ) : null}
    </ListItem>
  )
}

/**
 * One of two views in the same place, crossfading when the choice changes, such as a list and its
 * empty state. Both should be the same height, so nothing around them jumps.
 */
export function Crossfade({
  showSecond,
  first,
  second,
}: {
  showSecond: boolean
  first: ReactNode
  second: ReactNode
}) {
  return (
    <Box modifiers={[fillMaxWidth()]}>
      <AnimatedVisibility
        visible={!showSecond}
        enterTransition={EnterTransition.fadeIn()}
        exitTransition={ExitTransition.fadeOut()}
      >
        {first}
      </AnimatedVisibility>
      <AnimatedVisibility
        visible={showSecond}
        enterTransition={EnterTransition.fadeIn()}
        exitTransition={ExitTransition.fadeOut()}
      >
        {second}
      </AnimatedVisibility>
    </Box>
  )
}

/**
 * One of several views filling the same place, crossfading as the current one changes, such as
 * a page's loading, empty and found states. Each fills the place, so its content can centre in it.
 */
export function FadeStates<K extends string>({
  current,
  states,
}: {
  current: K
  states: Record<K, ReactNode>
}) {
  const keys: K[] = Object.keys(states).filter((key): key is K => key in states)

  return (
    <Box modifiers={[fillMaxSize()]}>
      {keys.map((key) => (
        <AnimatedVisibility
          key={key}
          visible={key === current}
          enterTransition={EnterTransition.fadeIn()}
          exitTransition={ExitTransition.fadeOut()}
          modifiers={[fillMaxSize()]}
        >
          {states[key]}
        </AnimatedVisibility>
      ))}
    </Box>
  )
}
