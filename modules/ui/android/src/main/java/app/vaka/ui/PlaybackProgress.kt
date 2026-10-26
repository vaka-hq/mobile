package app.vaka.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import kotlinx.coroutines.delay

/**
 * How far past the last reported position the shown one may run, in seconds of audio: the player
 * reports twice a second, so a stall it has not reported yet only ever shows as a short hop back.
 */
private const val maxLeadSeconds = 1.5f

/** Waits shorter than this go frame by frame. */
private const val frameSeconds = 1f / 60f

/** The longest wait between moves, half the time between reports, as before the first layout. */
private const val longestWaitSeconds = 0.25f

/**
 * The playback position in a span of `max` seconds, carried forward between the player's reports
 * while it advances, at `rate` seconds per second. It moves when it would move about a pixel, so
 * a long span does not redraw every frame; `width` is the drawn length in pixels.
 */
@Composable
private fun advancingPosition(
  value: Float,
  max: Float,
  advancing: Boolean,
  rate: Float,
  width: () -> Int
): Float {
  // Back to the report itself whenever a new one arrives.
  var ahead by remember(value, max, advancing, rate) { mutableFloatStateOf(0f) }

  LaunchedEffect(value, max, advancing, rate) {
    if (!advancing || rate <= 0f || max <= 0f) return@LaunchedEffect
    val start = withFrameNanos { it }

    while (ahead < maxLeadSeconds * rate && value + ahead < max) {
      val pixelSeconds = (max / width().coerceAtLeast(1) / rate).coerceAtMost(longestWaitSeconds)
      if (pixelSeconds > frameSeconds) delay((pixelSeconds * 1000).toLong())
      withFrameNanos { now ->
        ahead = ((now - start) / 1_000_000_000f * rate).coerceAtMost(maxLeadSeconds * rate)
      }
    }
  }

  return (value + ahead).coerceIn(0f, max.coerceAtLeast(0f))
}

@OptimizedComposeProps
data class PlaybackSliderProps(
  // Seconds into the span, as last reported.
  val value: Float = 0f,
  val max: Float = 1f,
  val enabled: Boolean = true,
  // Playback is moving through the span, so the thumb glides on between reports.
  val advancing: Boolean = false,
  // Seconds of audio per second, the playback speed.
  val rate: Float = 1f
) : ComposeProps

@OptimizedRecord
data class PlaybackValueEvent(
  @Field val value: Float
) : Record

/**
 * A Material slider through a span of playback, such as a chapter, whose thumb glides with the
 * audio rather than stepping at each report. A drag shows where it is, and once released the
 * thumb stays there until the next report, so it never flicks back to the old place.
 */
@Composable
fun FunctionalComposableScope.PlaybackSliderContent(
  props: PlaybackSliderProps,
  onValueChange: (Float) -> Unit,
  onValueChangeFinished: () -> Unit
) {
  val width = remember { mutableIntStateOf(0) }
  var dragged by remember { mutableStateOf<Float?>(null) }
  var dragging by remember { mutableStateOf(false) }
  // A released drag lasts until the position is reported again.
  LaunchedEffect(props.value) {
    if (!dragging) dragged = null
  }
  val playing = advancingPosition(
    props.value,
    props.max,
    props.advancing && dragged == null,
    props.rate,
    width::intValue
  )

  Slider(
    value = dragged ?: playing,
    onValueChange = {
      dragging = true
      dragged = it
      onValueChange(it)
    },
    onValueChangeFinished = {
      dragging = false
      onValueChangeFinished()
    },
    valueRange = 0f..props.max.coerceAtLeast(0.001f),
    enabled = props.enabled,
    modifier = Modifier.fillMaxWidth().onSizeChanged { width.intValue = it.width }
  )
}

@OptimizedComposeProps
data class PlaybackLineProps(
  val value: Float = 0f,
  val max: Float = 1f,
  val advancing: Boolean = false,
  val rate: Float = 1f
) : ComposeProps

/**
 * A flat 2 dp line along an edge, such as the mini player's top, filling in the primary colour as
 * playback moves through a span; it glides with the audio, as the full player's slider does.
 */
@Composable
fun FunctionalComposableScope.PlaybackLineContent(props: PlaybackLineProps) {
  val width = remember { mutableIntStateOf(0) }
  val position = advancingPosition(props.value, props.max, props.advancing, props.rate, width::intValue)
  val fraction = if (props.max > 0f) position / props.max else 0f
  val track = MaterialTheme.colorScheme.surfaceContainer
  val indicator = MaterialTheme.colorScheme.primary

  Canvas(Modifier.fillMaxWidth().height(2.dp).onSizeChanged { width.intValue = it.width }) {
    drawRect(track)
    drawRect(indicator, Offset.Zero, Size(size.width * fraction.coerceIn(0f, 1f), size.height))
  }
}
