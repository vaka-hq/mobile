import { useLingui } from '@lingui/react/macro'
import { type ReactNode, useRef, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fillMaxWidth, padding, weight } from '@/lib/compose-modifiers'
import { Column, FilterChip, Row, Slider, Text, useMaterialColors } from '@/lib/compose-ui'
import { type SleepTimer, setSleepTimer, setSpeed } from '@/player/controller'
import { maxPlaybackSpeed } from '@/settings/preferences'
import {
  ModalSheet,
  type ModalSheetRef,
  SheetCardList as SheetList,
} from '../../modules/android-components'
import { speedLabel } from './format'
import type { Glyph } from './glyphs'
import { CardItem, Empty } from './primitives'
import { Action } from './screen'

/** The share of the screen a list sheet opens to at least, however little it holds. */
const listSheetFraction = 0.5

/** The sheet's handle (22 + 4 + 12 dp) and title row (48 dp button, 12 dp below). */
const sheetHeaderHeight = 98

/**
 * How tall a list sheet's body is when it opens, below its header: a list keeps at least this
 * height, so the sheet stays put as items come and go, and its empty state centres in it.
 */
export function useOpenSheetBody() {
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()

  return window.height * listSheetFraction - sheetHeaderHeight - insets.bottom
}

export type SheetProps = {
  title: string
  /** A line under the title, such as how much of a series is in the library. */
  subtitle?: string | null
  /** A control at the end of the title row, such as adding a bookmark. */
  action?: ReactNode
  /** Controls at the end of the title row that can close the sheet, such as a close button. */
  closingActions?: (close: () => void) => ReactNode
  onDismiss: () => void
  /** The content; `close` animates the sheet away, after which `onDismiss` follows. */
  children: (close: () => void) => ReactNode
}

/**
 * The app's bottom sheet, the reference app's native wrapper: it opens at its content's height up
 * to half the screen, grows to full height as its content scrolls, and closes the same way from
 * Back, the scrim or a choice made inside it.
 */
export function Sheet({
  title,
  subtitle,
  action,
  closingActions,
  onDismiss,
  children,
}: SheetProps) {
  const sheet = useRef<ModalSheetRef>(null)
  const close = () => void sheet.current?.hide()
  const colors = useMaterialColors()

  return (
    <ModalSheet ref={sheet} onDismissRequest={onDismiss}>
      <Column modifiers={[fillMaxWidth()]}>
        <Row verticalAlignment='center' modifiers={[fillMaxWidth(), padding(24, 0, 12, 12)]}>
          <Column modifiers={[weight(1)]}>
            <Text style={{ typography: 'titleLarge' }}>{title}</Text>
            {subtitle ? (
              <Text color={colors.onSurfaceVariant} style={{ typography: 'bodyMedium' }}>
                {subtitle}
              </Text>
            ) : null}
          </Column>
          {action}
          {closingActions?.(close)}
        </Row>
        {children(close)}
      </Column>
    </ModalSheet>
  )
}

const minSpeed = 0.5

const maxSpeed = maxPlaybackSpeed

const speedStep = 0.05

/** The speeds most listeners pick; finer steps are on the slider. */
const speedPresets = [1, 1.2, 1.5, 2, 3] as const

/** A fine speed slider with a few common presets. */
export function SpeedSheet({ speed, onDismiss }: { speed: number; onDismiss: () => void }) {
  const { t } = useLingui()
  const [value, setValue] = useState(speed)
  // The latest slider value, read when a drag or tap ends: the end can arrive before React has
  // rendered the value it follows.
  const latest = useRef(speed)

  function apply(next: number) {
    const rounded = Math.round(next / speedStep) * speedStep

    latest.current = rounded
    setValue(rounded)
    setSpeed(rounded)
  }

  return (
    <Sheet
      title={t({ message: 'Playback speed', comment: 'Title of the speed sheet' })}
      onDismiss={onDismiss}
    >
      {() => (
        <Column modifiers={[fillMaxWidth(), padding(0, 0, 0, 24)]}>
          <Text
            style={{ typography: 'displaySmall', textAlign: 'center' }}
            modifiers={[fillMaxWidth()]}
          >
            {speedLabel(value)}
          </Text>
          <Slider
            value={value}
            min={minSpeed}
            max={maxSpeed}
            steps={Math.round((maxSpeed - minSpeed) / speedStep) - 1}
            onValueChange={(next) => {
              latest.current = next
              setValue(next)
            }}
            onValueChangeFinished={() => apply(latest.current)}
            modifiers={[fillMaxWidth(), padding(24, 8, 24, 8)]}
          />
          <Row
            horizontalArrangement={{ spacedBy: 8 }}
            modifiers={[fillMaxWidth(), padding(24, 0, 24, 0)]}
          >
            {speedPresets.map((preset) => (
              <FilterChip
                key={preset}
                selected={Math.abs(preset - value) < 0.001}
                onClick={() => apply(preset)}
                modifiers={[weight(1)]}
              >
                <FilterChip.Label>
                  <Text style={{ textAlign: 'center' }} modifiers={[fillMaxWidth()]}>
                    {speedLabel(preset)}
                  </Text>
                </FilterChip.Label>
              </FilterChip>
            ))}
          </Row>
        </Column>
      )}
    </Sheet>
  )
}

const sleepMinutes = [5, 10, 15, 30, 45, 60, 90] as const

/** Stops playback after a time or at the end of the chapter; the running choice is checked. */
export function SleepSheet({
  sleep,
  hasChapters,
  onDismiss,
}: {
  sleep: SleepTimer | null
  hasChapters: boolean
  onDismiss: () => void
}) {
  const { t } = useLingui()

  const options: { key: string; label: string; selected: boolean; choose: () => void }[] = [
    {
      key: 'off',
      label: t({ message: 'Off', comment: 'Sleep timer option' }),
      selected: sleep === null,
      choose: () => setSleepTimer(null),
    },
    ...sleepMinutes.map((minutes) => ({
      key: String(minutes),
      label: t({ message: `${minutes} minutes`, comment: 'Sleep timer option' }),
      selected: sleep?.kind === 'time' && sleep.minutes === minutes,
      choose: () => setSleepTimer(minutes),
    })),
    ...(hasChapters
      ? [
          {
            key: 'chapter',
            label: t({ message: 'End of chapter', comment: 'Sleep timer option' }),
            selected: sleep?.kind === 'chapter',
            choose: () => setSleepTimer('chapter'),
          },
        ]
      : []),
  ]

  return (
    <Sheet
      title={t({ message: 'Sleep timer', comment: 'Title of the sleep timer sheet' })}
      onDismiss={onDismiss}
    >
      {(close) => (
        // Opens far enough to show the running choice, however far down it is.
        <SheetList
          initialIndex={Math.max(
            0,
            options.findIndex((option) => option.selected),
          )}
        >
          {options.map((option, index) => (
            <CardItem
              key={option.key}
              card={{ index, count: options.length }}
              selected={option.selected}
              checked={option.selected}
              headline={option.label}
              onPress={() => {
                option.choose()
                close()
              }}
            />
          ))}
        </SheetList>
      )}
    </Sheet>
  )
}

/** A sheet's list of connected cards, opened with `initialIndex` in view. */
export { SheetList }

/**
 * A filter's choices in a sheet, as the reference app has them; `children` are the choices, such
 * as checked cards. A filter that takes several choices has a clear button in its title row,
 * disabled while nothing is chosen. With nothing to choose from, `empty` says so instead.
 */
export function FilterSheet({
  title,
  clear,
  empty,
  onDismiss,
  children,
}: {
  title: string
  clear?: { label: string; enabled: boolean; onPress: () => void }
  /** Shown when there are no choices, such as no series in the library yet. */
  empty?: { glyph: Glyph; title: string; message?: string } | null
  onDismiss: () => void
  /** The choices; given `close`, a choice can put the sheet away, as picking the one of a kind does. */
  children: (close: () => void) => ReactNode
}) {
  return (
    <Sheet
      title={title}
      onDismiss={onDismiss}
      action={
        clear ? (
          <Action
            glyph='clearFilters'
            label={clear.label}
            enabled={clear.enabled}
            onPress={clear.onPress}
          />
        ) : null
      }
    >
      {(close) =>
        empty ? (
          <Empty glyph={empty.glyph} title={empty.title} message={empty.message} height={220} />
        ) : (
          <SheetList>{children(close)}</SheetList>
        )
      }
    </Sheet>
  )
}
