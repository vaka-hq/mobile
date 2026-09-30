package expo.modules.androidcomponents

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import expo.modules.ui.findChildSlotView
import expo.modules.ui.renderSlot

@OptimizedComposeProps
data class ConnectedActionsProps(
  val labels: List<String> = emptyList(),
  val enabled: List<Boolean> = emptyList(),
  // Filled in the primary colour, as the page's main actions; otherwise tonal.
  val filled: List<Boolean> = emptyList(),
  // A tonal action that is switched on, such as a book already in the library.
  val selected: List<Boolean> = emptyList(),
  // A compact button showing only its icon; the label stays its description.
  val iconOnly: List<Boolean> = emptyList(),
  // Card rows continue directly below, so the outer bottom corners meet them tightly.
  val joinedBelow: Boolean = false
) : ComposeProps

private val iconOnlyWidth = 72.dp

private val squeeze = 12.dp

/**
 * Connected buttons in the Material 3 Expressive style of the reference app's quantity group:
 * a pressed button springs its inner corners round and gives up width to its neighbours, and short
 * taps keep a 180 ms pulse. Switching a tonal action on springs its colour to the primary
 * container. Buttons with labels share the width the icon-only ones leave.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun FunctionalComposableScope.ConnectedActionsContent(
  props: ConnectedActionsProps,
  onPress: (Int) -> Unit
) {
  // Registers this scope so icon slots that change after the first composition recompose.
  Children(UIComposableScope(), filter = { false })

  val count = props.labels.size
  val colors = MaterialTheme.colorScheme
  val pressScope = rememberCoroutineScope()
  val interactions = remember(pressScope, count) {
    List(count) { PressPulseInteractionSource(pressScope) }
  }
  val fast = MaterialTheme.motionScheme.fastSpatialSpec<Dp>()
  val fastFloat = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
  val inner = 8.dp
  val round = 28.dp
  // Joined to card rows below, every bottom corner rests at the rows' tight join; a press still
  // springs the pressed button's inner corners round, bottom included.
  val join = 4.dp
  val outerBottom = if (props.joinedBelow) join else round
  val innerBottom = if (props.joinedBelow) join else inner
  val disabledContainer = colors.onSurface.copy(alpha = 0.12f)
  val disabledContent = colors.onSurface.copy(alpha = 0.38f)
  val pressed = interactions.map { it.collectIsPressedAsState().value }
  val pressAmounts = pressed.mapIndexed { index, isPressed ->
    animateFloatAsState(if (isPressed) 1f else 0f, fastFloat, label = "press-$index").value
  }

  BoxWithConstraints(Modifier.fillMaxWidth()) {
    val gap = ButtonGroupDefaults.ConnectedSpaceBetween
    val available = maxWidth - gap * (count - 1).coerceAtLeast(0)
    val compact = props.iconOnly.take(count).count { it }
    val flexible = (count - compact).coerceAtLeast(1)
    val flexibleWidth = (available - iconOnlyWidth * compact) / flexible
    val totalPress = pressAmounts.sum()

    Row(Modifier.fillMaxWidth().height(56.dp)) {
      props.labels.forEachIndexed { index, label ->
        key(index) {
          val icon = findChildSlotView(view, "icon$index")
          val enabled = props.enabled.getOrElse(index) { true }
          val filled = props.filled.getOrElse(index) { false }
          val iconOnly = props.iconOnly.getOrElse(index) { false }
          val leading = index == 0
          val trailing = index == count - 1
          val interaction = interactions[index]
          val isPressed = pressed[index]
          val selected by animateFloatAsState(
            if (props.selected.getOrElse(index) { false }) 1f else 0f,
            MaterialTheme.motionScheme.defaultSpatialSpec(),
            label = "selected-$index"
          )
          val innerTop by animateDpAsState(if (isPressed) round else inner, fast, label = "top-$index")
          val innerBottomCorner by animateDpAsState(
            if (isPressed) round else innerBottom,
            fast,
            label = "bottom-$index"
          )
          // The pressed button narrows and its neighbours share what it gives up.
          val others = (totalPress - pressAmounts[index]) / (count - 1).coerceAtLeast(1)
          val base = if (iconOnly) iconOnlyWidth else flexibleWidth
          val width = (base - squeeze * pressAmounts[index] + squeeze * others).coerceAtLeast(48.dp)
          val amount = selected.coerceIn(0f, 1f)
          val container = when {
            !enabled -> disabledContainer
            filled -> colors.primary
            else -> lerp(colors.secondaryContainer, colors.primaryContainer, amount)
          }
          val content = when {
            !enabled -> disabledContent
            filled -> colors.onPrimary
            else -> lerp(colors.onSecondaryContainer, colors.onPrimaryContainer, amount)
          }

          if (index > 0) {
            Spacer(Modifier.width(gap))
          }
          Surface(
            onClick = {
              interaction.pulseIfIdle()
              onPress(index)
            },
            enabled = enabled,
            shape = RoundedCornerShape(
              topStart = if (leading) round else innerTop,
              bottomStart = if (leading) outerBottom else innerBottomCorner,
              topEnd = if (trailing) round else innerTop,
              bottomEnd = if (trailing) outerBottom else innerBottomCorner
            ),
            color = container,
            contentColor = content,
            interactionSource = interaction,
            modifier = Modifier
              .width(width)
              .fillMaxHeight()
              .semantics {
                contentDescription = label
                role = Role.Button
              }
          ) {
            ActionContent(icon?.let { { it.renderSlot() } }, if (iconOnly) null else label)
          }
        }
      }
    }
  }
}

@Composable
private fun ActionContent(icon: (@Composable () -> Unit)?, label: String?) {
  Row(
    modifier = Modifier.padding(horizontal = if (label == null) 0.dp else 16.dp),
    horizontalArrangement = Arrangement.Center,
    verticalAlignment = Alignment.CenterVertically
  ) {
    icon?.invoke()
    if (label != null) {
      if (icon != null) {
        Spacer(Modifier.width(8.dp))
      }
      Text(
        label,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        style = MaterialTheme.typography.labelLarge
      )
    }
  }
}
