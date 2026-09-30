package expo.modules.androidcomponents

import android.os.SystemClock
import androidx.compose.foundation.interaction.Interaction
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.ui.geometry.Offset
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Keeps short taps visible for 180 ms without delaying the click, so every press shows its spring. */
internal class PressPulseInteractionSource(
  private val scope: CoroutineScope,
  private val now: () -> Long = { SystemClock.uptimeMillis() },
  private val wait: suspend (Long) -> Unit = { delay(it) }
) : MutableInteractionSource {
  private val visual = MutableInteractionSource()
  override val interactions = visual.interactions
  private val starts = mutableMapOf<PressInteraction.Press, Long>()
  private val releases = mutableMapOf<PressInteraction.Press, Job>()

  override suspend fun emit(interaction: Interaction) { dispatch(interaction) }
  override fun tryEmit(interaction: Interaction): Boolean {
    dispatch(interaction)
    return true
  }

  // Accessibility clicks can arrive without pointer/key press interactions.
  fun pulseIfIdle() {
    if (starts.isNotEmpty()) return
    val press = PressInteraction.Press(Offset.Unspecified)
    dispatch(press)
    dispatch(PressInteraction.Release(press))
  }

  private fun forward(interaction: Interaction) {
    scope.launch(start = CoroutineStart.UNDISPATCHED) { visual.emit(interaction) }
  }

  private fun dispatch(interaction: Interaction) {
    when (interaction) {
      is PressInteraction.Press -> {
        starts[interaction] = now()
        forward(interaction)
      }
      is PressInteraction.Release -> {
        val began = starts[interaction.press] ?: return
        releases.remove(interaction.press)?.cancel()
        val release = scope.launch(start = CoroutineStart.LAZY) {
          wait((180L - (now() - began)).coerceAtLeast(0L))
          starts.remove(interaction.press)
          releases.remove(interaction.press)
          visual.emit(interaction)
        }
        // Register before starting: a long press has no delay and can finish synchronously.
        releases[interaction.press] = release
        release.start()
      }
      is PressInteraction.Cancel -> {
        // A completed click keeps its pulse even if the button disables itself.
        if (releases.containsKey(interaction.press)) return
        starts.remove(interaction.press)
        forward(interaction)
      }
      else -> forward(interaction)
    }
  }
}
