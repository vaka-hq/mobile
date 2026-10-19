package app.vaka.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager

/**
 * A tap that nothing under it takes, such as one on the page around a search field, clears the
 * focus, so the field lets go and the keyboard closes. The parent sees a tap only after its
 * children: a button, a row or the field itself takes the tap first and keeps it for itself.
 */
@Composable
internal fun Modifier.clearFocusOnTap(): Modifier {
  val focusManager = LocalFocusManager.current

  return pointerInput(focusManager) {
    awaitEachGesture {
      awaitFirstDown(requireUnconsumed = false)
      // Null for a drag, a scroll or a tap a child took.
      if (waitForUpOrCancellation() != null) focusManager.clearFocus()
    }
  }
}
