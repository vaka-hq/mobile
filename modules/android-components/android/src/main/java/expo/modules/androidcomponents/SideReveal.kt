package expo.modules.androidcomponents

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope

@OptimizedComposeProps
data class SideRevealProps(
  val visible: Boolean = false
) : ComposeProps

private const val revealMillis = 320

/**
 * A row that joins the one around it as a whole: its room opens from nothing while it fades in
 * and travels out to its place, never clipped, so it is never cut off part way. Leaving, it
 * fades and travels back as the room closes.
 */
@Composable
fun FunctionalComposableScope.SideRevealContent(props: SideRevealProps) {
  AnimatedVisibility(
    visible = props.visible,
    // Held to the end of its opening room, it starts tucked behind what stands before it and
    // travels out as the room opens; the fade waits a moment so it never shows over that.
    enter = expandHorizontally(
      tween(revealMillis, easing = FastOutSlowInEasing),
      expandFrom = Alignment.End,
      clip = false
    ) + fadeIn(tween(revealMillis * 3 / 4, delayMillis = revealMillis / 4, easing = LinearOutSlowInEasing)),
    exit = shrinkHorizontally(
      tween(revealMillis, easing = FastOutSlowInEasing),
      shrinkTowards = Alignment.End,
      clip = false
    ) + fadeOut(tween(revealMillis / 2))
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Children(UIComposableScope(rowScope = this))
    }
  }
}
