import { useLingui } from '@lingui/react/macro'
import { useIsFocused, useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { Host } from '@/components/host'
import { fillMaxWidth, height, padding, weight } from '@/lib/compose-modifiers'
import { Box, Column, FilledIconButton, Icon, IconButton, Row, Text } from '@/lib/compose-ui'
import { useFeedback } from '@/lib/feedback'
import { miniPlayerHeight, useBelowMiniPlayer, usePlayerLayout } from '@/player/expansion'
import { usePlayerValue } from '@/player/use-player'
import { HeaderAppBar, LargeTopAppBar, Scaffold, TopAppBar } from '../../modules/android-components'
import { type Glyph, glyphs } from './glyphs'

export type ActionProps = {
  glyph: Glyph
  label: string
  onPress: () => void
  enabled?: boolean
}

/**
 * An icon button with its accessible label. It sets no colour: in an app bar or list item slot it
 * takes the colour that slot provides.
 */
export function Action({ glyph, label, onPress, enabled = true }: ActionProps) {
  return (
    <IconButton onClick={onPress} enabled={enabled}>
      <Icon source={glyphs[glyph]} size={24} contentDescription={label} />
    </IconButton>
  )
}

/** An action that stands out beside a field, such as the way to Settings: a filled icon button. */
export function FilledAction({ glyph, label, onPress }: Omit<ActionProps, 'enabled'>) {
  return (
    <FilledIconButton onClick={onPress}>
      <Icon source={glyphs[glyph]} size={24} contentDescription={label} />
    </FilledIconButton>
  )
}

function BackAction({ glyph, onPress }: { glyph: Glyph; onPress?: () => void }) {
  const { t } = useLingui()
  const router = useRouter()

  return (
    <Action
      glyph={glyph}
      label={t({ message: 'Back', comment: 'Top bar button returning to the previous screen' })}
      onPress={onPress ?? (() => router.back())}
    />
  )
}

/**
 * Room at the foot of a pushed screen for the mini player, which floats above the app in the
 * player layer; empty while nothing is loaded.
 */
function MiniPlayerSpace() {
  const belowMiniPlayer = useBelowMiniPlayer()
  // While playback is being started the player is out of sight, so no room opens for it yet; it
  // opens once the full player has faded in over the screen, out of view behind it. Closing, the
  // room goes as the fade starts, while the full player still covers the screen.
  const { starting, revealing, vanishing } = usePlayerLayout()

  const loaded =
    usePlayerValue((state) => state.book !== null) && !starting && !revealing && !vanishing

  return loaded ? (
    <Box modifiers={[fillMaxWidth(), height(miniPlayerHeight + belowMiniPlayer)]} />
  ) : null
}

export type ScreenFrameProps = {
  title: string
  /** Large collapsing bars for top-level destinations, small ones for detail screens. */
  appBar?: 'large' | 'small' | 'none'
  /** The navigation icon: a back arrow on pushed screens, a chevron on the player. */
  navigation?: 'back' | 'collapse'
  /** Replaces going back, such as collapsing the full player. */
  onNavigate?: () => void
  /** What sits at the start of a small app bar in place of the way back, such as a text button. */
  leading?: ReactNode
  /** What a small app bar shows in place of its title, such as a row of step dots. */
  titleContent?: ReactNode
  /** The small app bar's title centred on it, between its start and its actions. */
  centerTitle?: boolean
  actions?: ReactNode
  /** A small app bar slides away while scrolling down the content and returns on the way up. */
  collapseOnScroll?: boolean
  /**
   * What the top bar holds below its title row, such as filter chips, or in place of it with no
   * app bar, such as a search field and its chips. All of it slides away while scrolling down the
   * content and returns on the way up, and takes the scrolled colour once content passes under it.
   */
  header?: ReactNode
  /** Tab destinations sit above the app's navigation bar, which owns the system inset. */
  aboveNavigationBar?: boolean
  /** Leaves room at the foot for the floating mini player. */
  miniPlayerSpace?: boolean
  /** Shows the app's feedback in this screen's snackbar. */
  showsFeedback?: boolean
  /** Paints no background, for a frame on a surface that already does, such as the player's. */
  transparent?: boolean
  children?: ReactNode
}

/**
 * The screen shell inside an existing Compose tree: Material 3 Scaffold, its app bar and the
 * snackbar for feedback. `Screen` wraps it in its own Host; the full player uses it directly.
 */
export function ScreenFrame({
  title,
  appBar = 'small',
  navigation,
  onNavigate,
  leading,
  titleContent,
  centerTitle = false,
  actions,
  collapseOnScroll = false,
  header,
  aboveNavigationBar = false,
  miniPlayerSpace = false,
  showsFeedback = false,
  transparent = false,
  children,
}: ScreenFrameProps) {
  const containerColor = transparent ? '#00000000' : undefined
  const { clearFeedback, feedback } = useFeedback()
  const presented = showsFeedback ? feedback : null

  const navigationIcon = navigation ? (
    <BackAction glyph={navigation === 'collapse' ? 'collapse' : 'back'} onPress={onNavigate} />
  ) : leading !== undefined ? (
    // Always present, as the bar reads its slots once; what it holds may come and go.
    <Row verticalAlignment='center'>{leading}</Row>
  ) : undefined

  // Always present: actions often appear only once the screen's data has loaded.
  const actionRow = <Row verticalAlignment='center'>{actions}</Row>

  const topBar = header ? (
    <HeaderAppBar>
      {appBar === 'none' ? null : (
        <TitleRow title={title} navigationIcon={navigationIcon} actions={actionRow} />
      )}
      {header}
    </HeaderAppBar>
  ) : appBar === 'large' ? (
    <LargeTopAppBar
      title={title}
      navigationIcon={navigationIcon}
      actions={actionRow}
      containerColor={containerColor}
    />
  ) : appBar === 'small' ? (
    <TopAppBar
      title={title}
      titleContent={titleContent}
      centered={centerTitle}
      navigationIcon={navigationIcon}
      actions={actionRow}
      containerColor={containerColor}
    />
  ) : undefined

  return (
    <Scaffold
      topBar={topBar}
      containerColor={containerColor}
      bottomBar={
        // The column stays mounted because the Scaffold resolves its slots once; with nothing
        // playing it is empty and the screen keeps its usual system inset.
        miniPlayerSpace ? (
          <Column>
            <MiniPlayerSpace />
          </Column>
        ) : undefined
      }
      scrollBehavior={
        header
          ? 'enterAlways'
          : appBar === 'large'
            ? 'exitUntilCollapsed'
            : appBar === 'small'
              ? collapseOnScroll
                ? 'enterAlways'
                : 'pinned'
              : 'none'
      }
      bottomInset={!aboveNavigationBar}
      snackbarId={presented?.id ?? 0}
      snackbarMessage={presented?.message ?? ''}
      onSnackbarDismiss={presented ? () => clearFeedback(presented.id) : undefined}
    >
      {children}
    </Scaffold>
  )
}

/**
 * The title row of a top bar that holds more below it, laid out as Material's small app bar: the
 * way back, the title and the actions, 64 dp tall.
 */
function TitleRow({
  title,
  navigationIcon,
  actions,
}: {
  title: string
  navigationIcon: ReactNode
  actions: ReactNode
}) {
  return (
    <Row
      verticalAlignment='center'
      modifiers={[fillMaxWidth(), height(64), padding(navigationIcon ? 4 : 16, 0, 4, 0)]}
    >
      {navigationIcon}
      <Box modifiers={[weight(1), padding(navigationIcon ? 12 : 0, 0, 0, 0)]}>
        <Text maxLines={1} overflow='ellipsis' style={{ typography: 'titleLarge' }}>
          {title}
        </Text>
      </Box>
      {actions}
    </Row>
  )
}

export type ScreenProps = Omit<
  ScreenFrameProps,
  'miniPlayerSpace' | 'showsFeedback' | 'transparent'
> & {
  /**
   * Pushed screens leave room for the mini player at their foot, as the tabs do above their bar.
   * Screens opened from the full player, such as chapters, turn it off.
   */
  miniPlayer?: boolean
}

/** A whole screen in one Compose tree, showing feedback while it is focused. */
export function Screen({ miniPlayer = true, aboveNavigationBar = false, ...props }: ScreenProps) {
  const focused = useIsFocused()

  return (
    <Host style={{ flex: 1 }}>
      <ScreenFrame
        {...props}
        aboveNavigationBar={aboveNavigationBar}
        miniPlayerSpace={miniPlayer && !aboveNavigationBar}
        showsFeedback={focused}
      />
    </Host>
  )
}
