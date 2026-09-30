package expo.modules.androidcomponents

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import kotlinx.coroutines.launch

data class StepDotsProps(val count: Int = 1, val current: Int = 0) : ComposeProps

private val dotSize = 8.dp
private val pillWidth = 24.dp
private val dotGap = 8.dp

/**
 * Which step of a short sequence is showing: a dot for each, and a long pill in the primary colour
 * over the current one. Moving to another step, the pill slides there, its leading edge a little
 * ahead of its trailing one so it stretches as it travels, and the dots it passes slide aside to
 * make room and back, whichever way the step goes. It is drawn rather than laid out, so nothing is
 * clipped, and the row keeps its width.
 */
@Composable
fun FunctionalComposableScope.StepDotsContent(props: StepDotsProps) {
  val count = props.count.coerceAtLeast(1)
  val active = MaterialTheme.colorScheme.primary
  val idle = MaterialTheme.colorScheme.outlineVariant
  // Where the pill's two ends are, in steps; the one heading the move gets there first.
  val head = remember { Animatable(props.current.toFloat()) }
  val tail = remember { Animatable(props.current.toFloat()) }

  LaunchedEffect(props.current) {
    val target = props.current.toFloat()
    launch { head.animateTo(target, tween(280, easing = FastOutSlowInEasing)) }
    launch { tail.animateTo(target, tween(420, delayMillis = 40, easing = FastOutSlowInEasing)) }
  }

  Canvas(Modifier.size(pillWidth + (dotSize + dotGap) * (count - 1), dotSize)) {
    val step = (dotSize + dotGap).toPx()
    val dot = dotSize.toPx()
    val radius = CornerRadius(size.height / 2, size.height / 2)
    val along = (head.value + tail.value) / 2

    // Dots past the pill sit a pill's extra length further on; those it moves over slide back.
    for (index in 0 until count) {
      val x = index * step + (pillWidth - dotSize).toPx() * (index - along).coerceIn(0f, 1f)
      drawRoundRect(idle, Offset(x, 0f), Size(dot, dot), radius)
    }

    val left = minOf(head.value, tail.value) * step
    val right = maxOf(head.value, tail.value) * step + pillWidth.toPx()
    drawRoundRect(active, Offset(left, 0f), Size(right - left, dot), radius)
  }
}
