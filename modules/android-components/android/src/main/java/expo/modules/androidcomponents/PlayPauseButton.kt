package expo.modules.androidcomponents

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularWavyProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import kotlinx.coroutines.delay
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.OptimizedComposeProps

@OptimizedComposeProps
data class PlayPauseButtonProps(
  // Shows pause while the listener wants sound, buffering included.
  val playing: Boolean = false,
  val buffering: Boolean = false,
  // The button's size in dp.
  val dimension: Double = 48.0,
  // A filled primary button, as in the full player; otherwise an icon on the surface around it.
  val filled: Boolean = false,
  val playLabel: String = "",
  val pauseLabel: String = ""
) : ComposeProps

private fun symbol(pathData: String) = ImageVector.Builder(
  defaultWidth = 24.dp,
  defaultHeight = 24.dp,
  viewportWidth = 960f,
  viewportHeight = 960f
).addPath(PathParser().parsePathString(pathData).toNodes(), fill = SolidColor(Color.Black)).build()

// The filled Material Symbols the rest of the app uses for play and pause.
private val playSymbol = symbol("M320,760L320,200L760,480L320,760Z")
private val pauseSymbol = symbol("M560,760L560,200L720,200L720,760L560,760ZM240,760L240,200L400,200L400,760L240,760Z")

// Seeks served from the disk cache settle in about 300 ms; only longer waits show the ring.
private const val bufferingDelayMillis = 400L

/**
 * Play and pause as one control in the Material 3 Expressive manner: paused it is round, playing
 * its corners spring in towards a rounded square while the icon simply swaps. While the stream
 * buffers, a wavy ring turns around it with a gap between them.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun PlayPauseButtonContent(props: PlayPauseButtonProps, onPress: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  val size = props.dimension.toFloat().coerceAtLeast(24f).dp
  val bouncy = spring<androidx.compose.ui.unit.Dp>(
    dampingRatio = Spring.DampingRatioMediumBouncy,
    stiffness = Spring.StiffnessMediumLow
  )
  val pressScope = rememberCoroutineScope()
  val interaction = remember(pressScope) { PressPulseInteractionSource(pressScope) }
  val pressed by interaction.collectIsPressedAsState()
  // The ring surrounds the button with a gap rather than squeezing it: it is drawn past the
  // button's bounds, so the button keeps its size and nothing around it moves.
  // Its wave reaches inwards by about its own thickness, so this leaves a gap of about 5 dp.
  val ringSize = (size * 1.25f).coerceAtLeast(size + 20.dp)
  val ringStroke = Stroke(
    width = with(LocalDensity.current) { 3.dp.toPx() },
    cap = StrokeCap.Round
  )
  // Buffering that ends within a moment, as after a seek into memory, shows nothing, so quick
  // skips never make the button twitch.
  var showsBuffering by remember { mutableStateOf(false) }

  LaunchedEffect(props.buffering) {
    if (props.buffering) {
      delay(bufferingDelayMillis)
    }

    showsBuffering = props.buffering
  }

  // Pressing squares the corners a little further, as the connected buttons do. While the ring
  // turns, the button is round, so the gap to the ring is even all the way round.
  val corner by animateDpAsState(
    when {
      pressed -> size * 0.2f
      showsBuffering -> size / 2
      props.playing -> size * 0.3f
      else -> size / 2
    },
    bouncy,
    label = "corner"
  )

  val label = if (props.playing) props.pauseLabel else props.playLabel
  val iconSize = size * if (props.filled) 0.5f else 0.58f
  val content = if (props.filled) colors.onPrimary else colors.onSurface

  Box(Modifier.size(size), contentAlignment = Alignment.Center) {
    AnimatedVisibility(
      visible = showsBuffering,
      modifier = Modifier.requiredSize(ringSize),
      enter = fadeIn() + scaleIn(initialScale = 0.85f),
      exit = fadeOut() + scaleOut(targetScale = 0.85f)
    ) {
      CircularWavyProgressIndicator(
        modifier = Modifier.fillMaxSize(),
        color = if (props.filled) colors.primary else colors.onSurfaceVariant,
        trackColor = Color.Transparent,
        stroke = ringStroke,
        trackStroke = ringStroke
      )
    }

    Surface(
      onClick = {
        interaction.pulseIfIdle()
        onPress()
      },
      interactionSource = interaction,
      // The spring overshoots; the corner may not go below zero.
      shape = RoundedCornerShape(corner.coerceAtLeast(0.dp)),
      color = if (props.filled) colors.primary else Color.Transparent,
      contentColor = content,
      modifier = Modifier
        .fillMaxSize()
        .semantics {
          contentDescription = label
          role = Role.Button
        }
    ) {
      Box(contentAlignment = Alignment.Center) {
        Icon(
          imageVector = if (props.playing) pauseSymbol else playSymbol,
          contentDescription = null,
          modifier = Modifier.size(iconSize)
        )
      }
    }
  }
}
