package expo.modules.androidcomponents

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.runtime.getValue
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ToggleButtonShapes
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import expo.modules.ui.findChildSlotView
import expo.modules.ui.renderSlot
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptimizedComposeProps
data class ConnectedButtonGroupProps(
  val labels: List<String> = emptyList(),
  // Spoken instead of the label where the label alone says too little, such as "1.25×".
  val descriptions: List<String> = emptyList(),
  // A checked button shows a setting that is on, such as a speed other than normal.
  val checked: List<Boolean> = emptyList(),
  // Buttons that also act when held, such as adding a bookmark without opening the list.
  val longPressable: List<Boolean> = emptyList()
) : ComposeProps

@OptimizedRecord
data class ButtonGroupPressEvent(
  @Field val index: Int
) : Record

private val tight = 12.dp

/** Half the 56 dp button height. Fixed rather than a percentage, which the button's shape
 * animation resolves wrongly at rest, leaving the ends flat until the first press. */
private val roundCorner = 28.dp

private val round = RoundedCornerShape(roundCorner)

/** Space between the card's edge and its buttons. */
private val cardPadding = 8.dp

/** The card's corners follow the buttons' ends: their radius plus the space around them. */
private val card = RoundedCornerShape(roundCorner + cardPadding)

/**
 * A connected button's shapes: round at the group's ends, tight where it meets a neighbour, and
 * fully round while pressed or checked, as the Listen and library pair on the book page springs.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private fun connectedShapes(leading: Boolean, trailing: Boolean): ToggleButtonShapes {
  val start = CornerSize(if (leading) roundCorner else tight)
  val end = CornerSize(if (trailing) roundCorner else tight)

  return ToggleButtonShapes(
    shape = RoundedCornerShape(topStart = start, bottomStart = start, topEnd = end, bottomEnd = end),
    pressedShape = round,
    checkedShape = round
  )
}

/**
 * A Material 3 Expressive connected button group: toggle buttons side by side in a pill-shaped
 * tonal container, with tight inner corners and round outer ends. Buttons are icons, their labels spoken; a checked one fills,
 * rounds fully and widens to show its label, and a pressed one springs its corners round and
 * narrows while its neighbours widen. Each button's
 * icon comes from the slot `icon<index>`.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun FunctionalComposableScope.ConnectedButtonGroupContent(
  props: ConnectedButtonGroupProps,
  onPress: (Int) -> Unit,
  onLongPress: (Int) -> Unit
) {
  // Registers this scope so icon slots that change after the first composition recompose.
  Children(UIComposableScope(), filter = { false })

  val count = props.labels.size
  val pressScope = rememberCoroutineScope()

  val colors = MaterialTheme.colorScheme

  // Tonal buttons (secondaryContainer) in a pill of their own; a checked one takes primary.
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .clip(card)
      .background(colors.surfaceContainerHigh)
      .padding(cardPadding),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    props.labels.forEachIndexed { index, label ->
      val icon = findChildSlotView(view, "icon$index")
      val description = props.descriptions.getOrNull(index)?.takeIf { it.isNotBlank() } ?: label
      val checked = props.checked.getOrElse(index) { false }
      val holdable = props.longPressable.getOrElse(index) { false }
      val haptics = LocalHapticFeedback.current
      // A hold that acted pops the button: it swells with a bounce and flashes the tertiary
      // colour, then settles back.
      val celebration = remember { Animatable(0f) }
      val swell = remember { Animatable(1f) }

      fun celebrate() {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        pressScope.launch {
          launch {
            swell.animateTo(1.15f, spring(stiffness = Spring.StiffnessHigh))
            swell.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
          }
          celebration.animateTo(1f, tween(120))
          delay(450)
          celebration.animateTo(0f, tween(400))
        }
      }
      // Short taps stay visible long enough for the press shape to spring, as on the book page.
      val interaction = remember(pressScope) { PressPulseInteractionSource(pressScope) }
      val pressed by interaction.collectIsPressedAsState()
      // Only a checked button names its state; the rest are icons. Widths ease between the two,
      // and a pressed button gives up some width to its neighbours, then springs back.
      val share by animateFloatAsState(
        (if (checked) 28f + label.length * 7f else 28f) * (if (pressed) 0.8f else 1f),
        MaterialTheme.motionScheme.fastSpatialSpec(),
        label = "button-width"
      )

      ToggleButton(
        checked = checked,
        onCheckedChange = {
          interaction.pulseIfIdle()
          onPress(index)
        },
        interactionSource = interaction,
        colors = ToggleButtonDefaults.toggleButtonColors(
          containerColor = lerp(colors.secondaryContainer, colors.tertiary, celebration.value),
          contentColor = lerp(colors.onSecondaryContainer, colors.onTertiary, celebration.value),
          checkedContainerColor = colors.primary,
          checkedContentColor = colors.onPrimary
        ),
        shapes = connectedShapes(leading = index == 0, trailing = index == count - 1),
        contentPadding = PaddingValues(horizontal = 8.dp),
        modifier = Modifier
          .weight(share)
          .height(56.dp)
          .graphicsLayer {
            scaleX = swell.value
            scaleY = swell.value
          }
          .then(
            if (holdable) {
              Modifier.pointerInput(index) {
                // Watches the touch before the button does: a hold acts and swallows the rest of
                // the gesture, so the button's own tap never follows it.
                awaitEachGesture {
                  awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                  val released = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                    waitForUpOrCancellation(PointerEventPass.Initial)
                  }
                  if (released == null) {
                    onLongPress(index)
                    celebrate()
                    do {
                      val event = awaitPointerEvent(PointerEventPass.Initial)
                      event.changes.forEach { it.consume() }
                    } while (event.changes.any { it.pressed })
                  }
                }
              }
            } else {
              Modifier
            }
          )
          .semantics { contentDescription = description }
      ) {
        icon?.renderSlot()
        AnimatedVisibility(
          visible = checked,
          enter = fadeIn() + expandHorizontally(),
          exit = fadeOut() + shrinkHorizontally()
        ) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.width(6.dp))
            Text(
              label,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              style = MaterialTheme.typography.labelLarge
            )
          }
        }
      }
    }
  }
}
