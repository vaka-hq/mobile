import { useLingui } from '@lingui/react/macro'
import { clickable, fillMaxWidth, height, padding, weight } from '@/lib/compose-modifiers'
import { Column, Row } from '@/lib/compose-ui'
import { displayAuthors, displayCoverArt, displayTitle } from '@/library/display'
import { seekBy, togglePlay } from '@/player/controller'
import { expandPlayer, miniPlayerHeight, playerCoverKey } from '@/player/expansion'
import { useNowPlaying } from '@/player/use-player'
import { usePreferences } from '@/settings/preferences'
import { useErrorText } from '@/ui/errors'
import { useLabels } from '@/ui/labels'
import { Cover, EdgeProgress, PlayPauseButton, SkipButton, ToneText } from '@/ui/primitives'

/**
 * The collapsed player's content: the open book with its chapter progress and quick controls, at
 * the mini player's fixed height. Tapping it grows it into the full player; the player layer
 * draws its container, which may extend below this content.
 */
export function MiniPlayer() {
  const { t } = useLingui()
  const labels = useLabels()
  const errorText = useErrorText()
  const now = useNowPlaying()
  // Subscribed, so changing the interval in Settings updates the button at once.
  const { skipBackSeconds } = usePreferences()

  if (!now) {
    return null
  }

  const { summary } = now
  const chapterProgress = summary.chapterLength ? summary.chapterElapsed / summary.chapterLength : 0

  return (
    <Column modifiers={[fillMaxWidth(), height(miniPlayerHeight), clickable(expandPlayer)]}>
      <EdgeProgress progress={chapterProgress} />
      <Row
        verticalAlignment='center'
        // The filled buttons end as far from the right edge as the cover starts from the left.
        modifiers={[fillMaxWidth(), padding(12, 8, 12, 8)]}
        horizontalArrangement={{ spacedBy: 12 }}
      >
        <Cover {...displayCoverArt(now.book)} dimension={48} sharedKey={playerCoverKey} />
        <Column modifiers={[weight(1)]}>
          <ToneText maxLines={1} overflow='ellipsis' style={{ typography: 'titleSmall' }}>
            {displayTitle(now.book)}
          </ToneText>
          <ToneText
            tone='secondary'
            maxLines={1}
            overflow='ellipsis'
            style={{ typography: 'bodySmall' }}
          >
            {now.error
              ? errorText(now.error)
              : summary.chapterCount > 1
                ? labels.chapter(summary.chapterTitle, summary.chapterIndex)
                : labels.authors(displayAuthors(now.book))}
          </ToneText>
        </Column>
        <SkipButton
          direction='back'
          seconds={skipBackSeconds}
          description={t({
            message: 'Skip back',
            comment: 'Mini player: jump backwards by the skip interval',
          })}
          compact
          onPress={() => void seekBy(-skipBackSeconds)}
        />
        <PlayPauseButton
          playing={now.playing || now.loading}
          buffering={now.loading}
          // The same size as the skip button beside it.
          dimension={40}
          filled
          playLabel={t({ message: 'Play', comment: 'Plays the audiobook' })}
          pauseLabel={t({ message: 'Pause', comment: 'Pauses the audiobook' })}
          onPress={togglePlay}
        />
      </Row>
    </Column>
  )
}
