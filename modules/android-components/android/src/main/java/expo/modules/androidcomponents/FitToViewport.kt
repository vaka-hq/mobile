package expo.modules.androidcomponents

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import kotlin.math.roundToInt

/** The height in pixels of the scrolling list a `FitColumn` sits in, as it is at rest. */
private val LocalViewportHeight = compositionLocalOf<Int?> { null }

@OptimizedComposeProps
data class ViewportBoxProps(
  // Unused; props records need a field.
  val unused: Boolean = false
) : ComposeProps

/**
 * Wraps a scrolling list and tells the `FitColumn`s inside it how tall the list shows, in the
 * same layout pass, so they fit the screen from their first frame. The height is the one at
 * rest: when the app bar slides away while scrolling, the list moves up and grows, and that
 * growth is taken off again, so what was fitted does not change as the page scrolls. The foot
 * moves only when something below, such as the mini player, comes or goes, and that counts.
 */
@Composable
fun FunctionalComposableScope.ViewportBoxContent(@Suppress("UNUSED_PARAMETER") props: ViewportBoxProps) {
  // The list's top in the window at rest, the lowest it has been, and where it is now.
  var restTop by remember { mutableFloatStateOf(Float.NaN) }
  var top by remember { mutableFloatStateOf(Float.NaN) }

  BoxWithConstraints(
    Modifier
      .fillMaxSize()
      .onGloballyPositioned { coordinates ->
        val y = coordinates.positionInWindow().y
        top = y
        if (restTop.isNaN() || y > restTop) restTop = y
      }
  ) {
    val risen = if (restTop.isNaN() || top.isNaN()) 0 else (restTop - top).roundToInt().coerceAtLeast(0)
    val height = if (constraints.hasBoundedHeight) constraints.maxHeight - risen else null

    CompositionLocalProvider(LocalViewportHeight provides height) {
      Box(Modifier.fillMaxSize()) {
        Children(UIComposableScope(boxScope = this))
      }
    }
  }
}

@OptimizedComposeProps
data class FitColumnProps(
  // Space between the children, in dp.
  val gap: Double = 20.0,
  // How far below the list's top the column starts, in dp.
  val top: Double = 0.0,
  // Room kept below the last child and above the list's foot, in dp.
  val clearance: Double = 16.0,
  // The least height the first child is given, in dp; below it the column runs off the screen.
  val minFirst: Double = 160.0
) : ComposeProps

/**
 * A column whose first child, such as a cover, takes whatever height the list it sits in has
 * left once the others are laid out, so they all show on the first screen with `clearance` to
 * spare. The others are measured first; the first is then measured within that height and
 * centred. Outside a `ViewportBox` the first child may be as tall as the column is wide.
 */
@Composable
fun FunctionalComposableScope.FitColumnContent(props: FitColumnProps) {
  val viewport = LocalViewportHeight.current

  Layout(content = { Children(UIComposableScope()) }) { measurables, constraints ->
    val width = constraints.maxWidth
    val loose = Constraints(maxWidth = width)
    val gap = props.gap.dp.roundToPx()
    val rest = measurables.drop(1).map { it.measure(loose) }
    val restHeight = rest.sumOf { it.height } + gap * rest.size
    val available = if (viewport != null) {
      viewport - props.top.dp.roundToPx() - restHeight - props.clearance.dp.roundToPx()
    } else {
      width
    }
    val firstHeight = available.coerceAtLeast(props.minFirst.dp.roundToPx())
    val first = measurables.firstOrNull()?.measure(Constraints(maxWidth = width, maxHeight = firstHeight))
    val height = (first?.height ?: 0) + restHeight

    layout(width, height) {
      var y = 0
      first?.let {
        it.place((width - it.width) / 2, 0)
        y = it.height
      }
      for (placeable in rest) {
        y += gap
        placeable.place(0, y)
        y += placeable.height
      }
    }
  }
}
