import { requireNativeModule, requireNativeView } from 'expo'
import type * as React from 'react'
import type { ReactNode, Ref } from 'react'
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native'
import type { AppBarProps, ScaffoldProps, ShortNavigationBarProps } from './AndroidComponents.types'

const AndroidComponentsModule = requireNativeModule<{
  bottomCornerRadius(): number
  readBookSections(uri: string): Promise<string>
  setReactNativeBack(enabled: boolean): boolean
}>('AndroidComponents')

/**
 * Whether React Native handles Back. Off at the root screen, so Android owns Back there and can
 * animate back to the home screen; false while no activity is attached yet.
 */
export function setReactNativeBack(enabled: boolean) {
  return AndroidComponentsModule.setReactNativeBack(enabled)
}

/**
 * An EPUB's contents with where each part starts, from 0 to 1, as JSON text for the caller to
 * parse: the parts the reader reports on opening it, read without opening it.
 */
export function readBookSections(uri: string) {
  return AndroidComponentsModule.readBookSections(uri)
}

/** The radius of the screen's bottom corners in dp, or 0 where Android does not report it. */
export function bottomCornerRadius() {
  return AndroidComponentsModule.bottomCornerRadius()
}

type SlotProps = {
  slotName: string
  children: ReactNode
}

const SlotNativeView: React.ComponentType<SlotProps> = requireNativeView('ExpoUI', 'SlotView')

const NativeScaffoldView: React.ComponentType<
  Omit<ScaffoldProps, 'topBar' | 'bottomBar' | 'floatingActionButton' | 'onSnackbarDismiss'> & {
    onSnackbarDismiss?: (event: NativeSyntheticEvent<Record<string, never>>) => void
  }
> = requireNativeView('AndroidComponents', 'ScaffoldView')

type NativeAppBarProps = Omit<AppBarProps, 'navigationIcon' | 'actions' | 'titleContent'> & {
  children?: ReactNode
}

const NativeTopAppBarView: React.ComponentType<NativeAppBarProps> = requireNativeView(
  'AndroidComponents',
  'TopAppBarView',
)

type GatedListProps = {
  contentPadding?: { start?: number; top?: number; end?: number; bottom?: number }
  /** Space between items, in dp. */
  spacing?: number
  children: ReactNode
}

const NativeGatedListView: React.ComponentType<GatedListProps> = requireNativeView(
  'AndroidComponents',
  'GatedListView',
)

/**
 * A lazy list, one item per child, under a `HeaderAppBar`: the bar slides away only when the
 * content overflows the list with the bar shown, so content that fits does not scroll at all, and
 * overflowing content gets room at its foot to pass fully under the bar.
 */
export function GatedList(props: GatedListProps) {
  return <NativeGatedListView {...props} />
}

const NativeStepDotsView: React.ComponentType<{ count: number; current: number }> =
  requireNativeView('AndroidComponents', 'StepDotsView')

/**
 * Which step of a short sequence is showing: a dot for each, the current one a long pill that
 * glides onto the next dot, or back, as the step changes.
 */
export function StepDots({ count, current }: { count: number; current: number }) {
  return <NativeStepDotsView count={count} current={current} />
}

const NativeHeaderFieldView: React.ComponentType<{ children: ReactNode }> = requireNativeView(
  'AndroidComponents',
  'HeaderFieldView',
)

/**
 * The pill a search field sits in: its resting container colour, blending to a brighter one as
 * the header it is in takes its scrolled colour, and back as the list returns to the top.
 */
export function HeaderField({ children }: { children: ReactNode }) {
  return <NativeHeaderFieldView>{children}</NativeHeaderFieldView>
}

const NativeBodyCentreView: React.ComponentType<{ children: ReactNode }> = requireNativeView(
  'AndroidComponents',
  'BodyCentreView',
)

/**
 * Fills the screen's body and centres what it holds in the part of it the keyboard leaves in
 * view, counting only what the keyboard covers rather than its whole height as `imePadding` does.
 */
export function BodyCentre({ children }: { children: ReactNode }) {
  return <NativeBodyCentreView>{children}</NativeBodyCentreView>
}

const NativeHeaderAppBarView: React.ComponentType<{ children: ReactNode }> = requireNativeView(
  'AndroidComponents',
  'HeaderAppBarView',
)

const NativeLargeTopAppBarView: React.ComponentType<NativeAppBarProps> = requireNativeView(
  'AndroidComponents',
  'LargeTopAppBarView',
)

const NativeShortNavigationBarView: React.ComponentType<{
  children: ReactNode
  onTabSelected?: (event: NativeSyntheticEvent<{ index: number }>) => void
  firstLabel: string
  secondLabel: string
  thirdLabel: string
  selectedIndex: number
}> = requireNativeView('AndroidComponents', 'ShortNavigationBarView')

export type CoverImageProps = {
  uri: string
  description?: string
  dimension: number
  cornerRadius: number
  color?: string | null
  aspect?: number | null
  /** Inside the expanding player, covers with the same key travel between its two layouts. */
  sharedKey?: string
  /** The slot takes the cover's own shape instead of a square, for a cover shown on its own. */
  hug?: boolean
  /** As large as the space it is given allows, in its own shape; `dimension` is then unused. */
  fill?: boolean
  onError?: () => void
}

const NativeCoverImageView: React.ComponentType<
  Omit<CoverImageProps, 'color' | 'aspect' | 'onError'> & {
    color?: string
    aspect: number
    onImageError?: () => void
  }
> = requireNativeView('AndroidComponents', 'CoverImageView')

/** A book cover drawn natively: colour placeholder, crossfade, and the cover's own proportions. */
export function CoverImage({ color, aspect, onError, ...props }: CoverImageProps) {
  return (
    <NativeCoverImageView
      {...props}
      color={color ?? undefined}
      aspect={aspect ?? 0}
      onImageError={onError ? () => onError() : undefined}
    />
  )
}

export type ConnectedAction = {
  key: string
  label: string
  icon: ReactNode
  enabled?: boolean
  /** Filled in the primary colour, as a page's main action; otherwise tonal. */
  filled?: boolean
  /** A tonal action that is switched on, such as a book already in the library. */
  selected?: boolean
  /** Shows only the icon; the label remains the accessible description. */
  iconOnly?: boolean
  onPress: () => void
}

export type ConnectedActionsProps = {
  actions: ConnectedAction[]
  /** Card rows continue directly below, so the bottom corners join them tightly. */
  joinedBelow?: boolean
}

const NativeConnectedActionsView: React.ComponentType<{
  children: ReactNode
  labels: string[]
  enabled: boolean[]
  filled: boolean[]
  selected: boolean[]
  iconOnly: boolean[]
  joinedBelow: boolean
  onActionPress: (event: NativeSyntheticEvent<{ index: number }>) => void
}> = requireNativeView('AndroidComponents', 'ConnectedActionsView')

export type ExpandingPlayerProps = {
  expanded: boolean
  /** The collapsed bar's height in dp. */
  collapsedHeight: number
  /** What lies below the collapsed bar while the view fills the screen, such as the tab bar. */
  collapsedBottomOffset: number
  /** How much of the space below the bar is filled in its colour; fades as it changes. */
  collapsedFill: number
  /** The player is being closed: it fades out before it goes. */
  vanishing?: boolean
  collapsed: ReactNode
  expandedContent: ReactNode
  /** The morph finished, collapsed or expanded. */
  onSettled?: (expanded: boolean) => void
  /** A fade finished: in as the player appeared, or out as it is closed. */
  onFaded?: (shown: boolean) => void
}

const NativeExpandingPlayerView: React.ComponentType<{
  children: ReactNode
  expanded: boolean
  collapsedHeight: number
  collapsedBottomOffset: number
  collapsedFill: number
  vanishing: boolean
  onSettled?: (event: NativeSyntheticEvent<{ expanded: boolean }>) => void
  onFaded?: (event: NativeSyntheticEvent<{ shown: boolean }>) => void
}> = requireNativeView('AndroidComponents', 'ExpandingPlayerView')

/**
 * The mini player and the full player as one Compose surface: the bar morphs into the whole view
 * and back, and covers with a shared key travel between the two.
 */
export function ExpandingPlayer({
  collapsed,
  expandedContent,
  onSettled,
  onFaded,
  vanishing = false,
  ...props
}: ExpandingPlayerProps) {
  return (
    <NativeExpandingPlayerView
      {...props}
      vanishing={vanishing}
      onSettled={onSettled ? (event) => onSettled(event.nativeEvent.expanded) : undefined}
      onFaded={onFaded ? (event) => onFaded(event.nativeEvent.shown) : undefined}
    >
      {/* Both slots stay mounted; the native view resolves them by name. */}
      <Slot slotName='collapsed'>{collapsed}</Slot>
      <Slot slotName='expanded'>{expandedContent}</Slot>
    </NativeExpandingPlayerView>
  )
}

const NativePlayerFadeView: React.ComponentType<{ children: ReactNode }> = requireNativeView(
  'AndroidComponents',
  'PlayerFadeView',
)

/**
 * Player content that fades in once the container has grown and out quickly as it closes, rather
 * than travelling with it. Outside the expanding player it is drawn as it is.
 */
export function PlayerFade({ children }: { children: ReactNode }) {
  return <NativePlayerFadeView>{children}</NativePlayerFadeView>
}

const NativeViewportBoxView: React.ComponentType<{ children: ReactNode }> = requireNativeView(
  'AndroidComponents',
  'ViewportBoxView',
)

/**
 * Wraps a scrolling list and tells the `FitColumn`s inside it how tall the list shows at rest, in
 * the same layout pass, so they fit the screen from their first frame.
 */
export function ViewportBox({ children }: { children: ReactNode }) {
  return <NativeViewportBoxView>{children}</NativeViewportBoxView>
}

export type FitColumnProps = {
  children: ReactNode
  /** Space between the children, in dp. */
  gap: number
  /** How far below the list's top the column starts, in dp. */
  top: number
  /** Room kept below the last child and above the list's foot, in dp. */
  clearance: number
  /** The least height the first child is given, in dp. */
  minFirst: number
}

const NativeFitColumnView: React.ComponentType<FitColumnProps> = requireNativeView(
  'AndroidComponents',
  'FitColumnView',
)

/**
 * A column whose first child, such as a cover, takes the height the list it sits in has left once
 * the others are laid out, so they all show on the first screen. Measured natively in one pass.
 */
export function FitColumn(props: FitColumnProps) {
  return <NativeFitColumnView {...props} />
}

const NativeSideRevealView: React.ComponentType<{ visible: boolean; children: ReactNode }> =
  requireNativeView('AndroidComponents', 'SideRevealView')

/**
 * A row that joins the one around it as a whole: its room opens while it fades in and travels
 * out to its place, never clipped part way as a plain horizontal expand would.
 */
export function SideReveal({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <NativeSideRevealView visible={visible}>{children}</NativeSideRevealView>
}

export type ModalSheetRef = {
  /** Animates the sheet away; `onDismissRequest` follows once it is hidden. */
  hide: () => Promise<void>
}

export type ModalSheetProps = {
  children: ReactNode
  ref?: Ref<ModalSheetRef>
  onDismissRequest: () => void
  /** The opening stop as a share of the screen, for content taller than it. Defaults to half. */
  initialHeightFraction?: number
  /** Shorter content opens at its own height. Defaults to true. */
  wrapContent?: boolean
}

const NativeModalSheetView: React.ComponentType<
  Omit<ModalSheetProps, 'onDismissRequest' | 'initialHeightFraction' | 'wrapContent'> & {
    initialHeightFraction: number
    wrapContent: boolean
    onDismissRequest: () => void
  }
> = requireNativeView('AndroidComponents', 'ModalSheetView')

/**
 * The app's one bottom sheet: content height up to its opening stop, full-height expansion as
 * its content scrolls, and one native dismissal path for Back, the scrim and `hide`.
 */
export function ModalSheet({
  initialHeightFraction = 0.5,
  wrapContent = true,
  onDismissRequest,
  ...props
}: ModalSheetProps) {
  return (
    <NativeModalSheetView
      {...props}
      initialHeightFraction={initialHeightFraction}
      wrapContent={wrapContent}
      onDismissRequest={() => onDismissRequest()}
    />
  )
}

const NativeSheetListView: React.ComponentType<{
  children: ReactNode
  initialIndex: number
  minHeight: number
}> = requireNativeView('AndroidComponents', 'SheetListView')

/**
 * A sheet's lazy list of connected cards that opens with `initialIndex` in view, such as the
 * chapter playing.
 */
export function SheetCardList({
  children,
  initialIndex = 0,
  minHeight = 0,
}: {
  children: ReactNode
  initialIndex?: number
  /** The list is at least this tall in dp, so a short list still opens the sheet this far. */
  minHeight?: number
}) {
  return (
    <NativeSheetListView initialIndex={initialIndex} minHeight={minHeight}>
      {children}
    </NativeSheetListView>
  )
}

export type ConnectedButtonGroupItem = {
  key: string
  label: string
  /** Spoken instead of the label where the label alone says too little. */
  description?: string
  icon: ReactNode
  /** Shows a setting that is on, such as a speed other than normal. */
  checked?: boolean
  onPress: () => void
  /** Held down, the button acts on this instead and celebrates with a spring and colour flash. */
  onLongPress?: () => void
}

const NativeConnectedButtonGroupView: React.ComponentType<{
  children: ReactNode
  labels: string[]
  descriptions: string[]
  checked: boolean[]
  longPressable: boolean[]
  onItemPress: (event: NativeSyntheticEvent<{ index: number }>) => void
  onItemLongPress: (event: NativeSyntheticEvent<{ index: number }>) => void
}> = requireNativeView('AndroidComponents', 'ConnectedButtonGroupView')

/** A Material 3 Expressive connected button group of icon-and-label toggle buttons. */
export function ConnectedButtonGroup({ items }: { items: ConnectedButtonGroupItem[] }) {
  return (
    <NativeConnectedButtonGroupView
      labels={items.map((item) => item.label)}
      descriptions={items.map((item) => item.description ?? '')}
      checked={items.map((item) => item.checked ?? false)}
      longPressable={items.map((item) => item.onLongPress !== undefined)}
      onItemPress={(event) => items[event.nativeEvent.index]?.onPress()}
      onItemLongPress={(event) => items[event.nativeEvent.index]?.onLongPress?.()}
    >
      {items.map((item, index) => (
        <Slot key={item.key} slotName={`icon${index}`}>
          {item.icon}
        </Slot>
      ))}
    </NativeConnectedButtonGroupView>
  )
}

export type PlayPauseButtonProps = {
  /** Shows pause while the listener wants sound, buffering included. */
  playing: boolean
  buffering: boolean
  /** The button's size in dp. */
  dimension: number
  /** A filled primary button, as in the full player; otherwise a plain icon button. */
  filled?: boolean
  playLabel: string
  pauseLabel: string
  onPress: () => void
}

const NativePlayPauseButtonView: React.ComponentType<
  Omit<PlayPauseButtonProps, 'onPress' | 'filled'> & { filled: boolean; onPress: () => void }
> = requireNativeView('AndroidComponents', 'PlayPauseButtonView')

/**
 * Play and pause as one Material 3 Expressive control: its shape morphs between round and a
 * rounded square, the icons swap with a scale and fade, and a wavy ring shows buffering.
 */
export function PlayPauseButton({ filled = false, onPress, ...props }: PlayPauseButtonProps) {
  return <NativePlayPauseButtonView {...props} filled={filled} onPress={() => onPress()} />
}

/** Connected Material 3 Expressive buttons with the reference app's spring on press. */
export function ConnectedActions({ actions, joinedBelow = false }: ConnectedActionsProps) {
  return (
    <NativeConnectedActionsView
      labels={actions.map((action) => action.label)}
      enabled={actions.map((action) => action.enabled ?? true)}
      filled={actions.map((action) => action.filled ?? false)}
      selected={actions.map((action) => action.selected ?? false)}
      iconOnly={actions.map((action) => action.iconOnly ?? false)}
      joinedBelow={joinedBelow}
      onActionPress={(event) => actions[event.nativeEvent.index]?.onPress()}
    >
      {actions.map((action, index) => (
        <Slot key={action.key} slotName={`icon${index}`}>
          {action.icon}
        </Slot>
      ))}
    </NativeConnectedActionsView>
  )
}

function Slot(props: SlotProps) {
  return <SlotNativeView {...props} />
}

export function Scaffold(props: ScaffoldProps) {
  const { topBar, bottomBar, floatingActionButton, children, onSnackbarDismiss, ...restProps } =
    props

  return (
    <NativeScaffoldView
      {...restProps}
      onSnackbarDismiss={onSnackbarDismiss ? () => onSnackbarDismiss() : undefined}
    >
      {/* The native Scaffold resolves slots once, so every slot stays mounted. */}
      <Slot slotName='topBar'>{topBar}</Slot>
      <Slot slotName='bottomBar'>{bottomBar}</Slot>
      <Slot slotName='floatingActionButton'>{floatingActionButton}</Slot>
      {children}
    </NativeScaffoldView>
  )
}

function appBarSlots({ navigationIcon, actions, titleContent }: AppBarProps) {
  return (
    <>
      {titleContent ? <Slot slotName='title'>{titleContent}</Slot> : null}
      {navigationIcon ? <Slot slotName='navigationIcon'>{navigationIcon}</Slot> : null}
      {/* Native app bars resolve slots once; actions that appear after loading need it mounted. */}
      <Slot slotName='actions'>{actions}</Slot>
    </>
  )
}

export function TopAppBar(props: AppBarProps) {
  const {
    navigationIcon: _navigationIcon,
    actions: _actions,
    titleContent: _title,
    ...rest
  } = props

  return <NativeTopAppBarView {...rest}>{appBarSlots(props)}</NativeTopAppBarView>
}

/**
 * A top bar made of its children, such as a title row over filter chips, that slides away as the
 * screen's list scrolls down and returns on any scroll up, and takes the scrolled container colour
 * once content passes under it. Goes in a Scaffold's top bar with the enter-always behaviour.
 */
export function HeaderAppBar({ children }: { children: ReactNode }) {
  return <NativeHeaderAppBarView>{children}</NativeHeaderAppBarView>
}

export function LargeTopAppBar(props: AppBarProps) {
  const {
    navigationIcon: _navigationIcon,
    actions: _actions,
    titleContent: _title,
    ...rest
  } = props

  return <NativeLargeTopAppBarView {...rest}>{appBarSlots(props)}</NativeLargeTopAppBarView>
}

export function ShortNavigationBar({
  icons,
  labels,
  selectedIndex,
  onSelect,
}: ShortNavigationBarProps) {
  return (
    <NativeShortNavigationBarView
      onTabSelected={(event) => onSelect(event.nativeEvent.index)}
      firstLabel={labels[0]}
      secondLabel={labels[1]}
      thirdLabel={labels[2] ?? ''}
      selectedIndex={selectedIndex}
    >
      <Slot slotName='firstIcon'>{icons[0]}</Slot>
      <Slot slotName='secondIcon'>{icons[1]}</Slot>
      {icons[2] ? <Slot slotName='thirdIcon'>{icons[2]}</Slot> : null}
    </NativeShortNavigationBarView>
  )
}

export type BookViewRef = {
  /** Hands the reader one command, as JSON. */
  send: (json: string) => Promise<void>
}

const NativeBookView: React.ComponentType<{
  ref?: Ref<BookViewRef>
  onMessage: (event: NativeSyntheticEvent<{ data: string }>) => void
  style?: StyleProp<ViewStyle>
}> = requireNativeView('AndroidComponents', 'BookView')

/**
 * The reader drawn natively in Compose: EPUB chapters laid out into pages or one scrolling column.
 * It takes commands as JSON through `send` and reports what happens as JSON events.
 */
export function BookView({
  ref,
  onMessage,
  style,
}: {
  ref?: Ref<BookViewRef>
  onMessage: (data: string) => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <NativeBookView
      ref={ref}
      style={style}
      onMessage={(event) => onMessage(event.nativeEvent.data)}
    />
  )
}
