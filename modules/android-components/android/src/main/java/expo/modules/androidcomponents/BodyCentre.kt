package expo.modules.androidcomponents

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalView
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import expo.modules.ui.isSlotView
import kotlin.math.roundToInt

@OptimizedComposeProps
class BodyCentreProps : ComposeProps

/**
 * Fills the screen's body and centres what it holds in the part of it the keyboard leaves in
 * view. `imePadding` would take the keyboard's whole height off the body, which on a tab already
 * ends above the navigation bar, and so centre it too high; this takes off only what the keyboard
 * covers.
 */
@Composable
fun FunctionalComposableScope.BodyCentreContent() {
  val ime = WindowInsets.ime
  val root = LocalView.current.rootView
  // Where the body's foot is in the window, which the keyboard's top is measured against.
  var foot by remember { mutableIntStateOf(-1) }

  Layout(
    content = { Children(UIComposableScope(), filter = { !isSlotView(it) }) },
    modifier = Modifier
      .fillMaxSize()
      .onGloballyPositioned { coordinates ->
        foot = (coordinates.positionInWindow().y + coordinates.size.height).roundToInt()
      }
  ) { measurables, constraints ->
    val width = constraints.maxWidth
    val height = constraints.maxHeight
    // Read while laying out, so the content follows the keyboard as it slides without composing.
    val keyboardTop = root.height - ime.getBottom(this)
    val covered = if (foot < 0) 0 else (foot - keyboardTop).coerceIn(0, height)
    val visible = height - covered
    val loose = constraints.copy(minWidth = 0, minHeight = 0, maxHeight = visible)
    val placeables = measurables.map { it.measure(loose) }

    layout(width, height) {
      for (placeable in placeables) {
        val y = ((visible - placeable.height) / 2).coerceAtLeast(0)
        placeable.placeRelative((width - placeable.width) / 2, y)
      }
    }
  }
}
