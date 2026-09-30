package expo.modules.androidcomponents

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.Spring
import androidx.compose.animation.animateColor
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.updateTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
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
import androidx.compose.animation.core.VectorConverter
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.delay
import androidx.compose.ui.layout.LookaheadScope
import androidx.compose.ui.layout.approachLayout
import androidx.compose.ui.geometry.Offset
import kotlin.math.roundToInt

@OptimizedComposeProps
data class ExpandingPlayerProps(
  val expanded: Boolean = false,
  // The collapsed bar's height, in dp.
  val collapsedHeight: Double = 64.0,
  // What sits below the collapsed bar while this view fills the screen, such as the tab bar, in dp.
  val collapsedBottomOffset: Double = 0.0,
  // How much of the space below the bar is filled in its colour, such as the room above the system
  // navigation bar on screens without a tab bar, in dp.
  val collapsedFill: Double = 0.0,
  // The player is being closed: it fades out, open or as the mini player, before it goes.
  val vanishing: Boolean = false
) : ComposeProps

@OptimizedRecord
data class PlayerSettledEvent(
  @Field val expanded: Boolean
) : Record

@OptimizedRecord
data class PlayerFadedEvent(
  // Faded in, as it appeared; or out, as it is closed.
  @Field val shown: Boolean
) : Record

/** The scopes content in the player's slots uses to join the transition, such as the cover. */
@OptIn(ExperimentalSharedTransitionApi::class)
class PlayerSharedScopes(
  val shared: SharedTransitionScope,
  val visibility: AnimatedVisibilityScope
)

val LocalPlayerSharedScopes = compositionLocalOf<PlayerSharedScopes?> { null }

/** How far the player's fading content travels while it fades in or out. */
private val fadeTravel = 24.dp

/** How quickly the fill below the bar covers the tab bar when going to a screen without one. */
private const val fillInMillis = 120

/** How long the tab bar takes to come back as the player shrinks, about as long as the shrink. */
private const val stripOutMillis = 480

/** How quickly the layout on its way out fades as the player opens or closes, in ms. */
private const val outgoingFadeMillis = 90

/** Frames the player waits for its real props before it builds its transition. */
private const val propsFrames = 2

/** How long the player takes to fade in as it first appears, in ms, after a few drawn frames. */
private const val appearMillis = 260
private const val appearFrames = 3

private const val backgroundKey = "player-background"

private const val contentKey = "player-content"

/** Whether the first props have settled; until then new values snap instead of animating. */
@Composable
private fun rememberSettled(): Boolean {
  var settled by remember { mutableStateOf(false) }

  LaunchedEffect(Unit) {
    // A view can compose with default props before the real ones arrive; those snap into place.
    delay(300)
    settled = true
  }

  return settled
}

/** Where the collapsed bar rests: its distance from the bottom and the fill below it, in dp. */
private data class BarPlacement(val offset: Dp, val fill: Dp)

/**
 * The mini player and the full player as one surface: switching `expanded` morphs the bar's bounds
 * into the view above `collapsedBottomOffset` and back (Material's container transform). Whatever
 * lies below the bar, such as the tab bar, is not grown over: a strip in the player's colour fades
 * in over it as the player opens and is gone at once when it closes, so the tab bar is back while
 * the player shrinks into the bar. Two layers share the moving bounds: an opaque
 * background whose colour blends from the bar's to the player's, so nothing behind ever shows
 * through, and the two layouts crossfading above it. Content marked with a shared key, such as
 * the cover, travels between its two places.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun FunctionalComposableScope.ExpandingPlayerContent(
  props: ExpandingPlayerProps,
  onSettled: (Boolean) -> Unit,
  onFaded: (Boolean) -> Unit
) {
  // Registers this scope so slot content that changes after the first composition recomposes.
  Children(UIComposableScope(), filter = { false })

  val collapsedSlot = findChildSlotView(view, "collapsed")
  val expandedSlot = findChildSlotView(view, "expanded")
  val colors = MaterialTheme.colorScheme
  val settled = rememberSettled()
  // The view can compose once with default props before the real ones arrive. The transition is
  // made only once they have, still unseen before the player fades in, so it starts in the state
  // it is given: a player that appears already open, as when playback starts from a book's page,
  // shows the full player at once rather than growing out of a bar that was never shown, and keeps
  // the one transition for its whole life, so closing morphs back as usual.
  var propsArrived by remember { mutableStateOf(false) }
  LaunchedEffect(Unit) {
    repeat(propsFrames) { withFrameNanos { } }
    propsArrived = true
  }
  if (!propsArrived) return
  val transition = updateTransition(props.expanded, label = "player")
  val barHeight = props.collapsedHeight.toFloat().coerceAtLeast(0f).dp
  val restingOffset = props.collapsedBottomOffset.toFloat().coerceAtLeast(0f).dp
  val fillTarget = props.collapsedFill.toFloat().coerceAtLeast(0f).dp
  // Moving between the tabs and a pushed screen, the bar slides between the two places with its own
  // opaque background, so nothing shows through it. Below it, the fill reaches from the bar to the
  // bottom and fades between the bar's colour and whatever lies there, such as the tab bar, in step
  // with the slide, so no gap opens under the bar. The first placement applies at once.
  val placement = BarPlacement(restingOffset, fillTarget)
  var shown by remember { mutableStateOf(placement) }
  var previous by remember { mutableStateOf<BarPlacement?>(null) }
  val contentOffset = remember { Animatable(restingOffset, Dp.VectorConverter) }
  // How strongly the fill shows. Going to a screen with one, it is there at once: the tab bar
  // vanishes with its screen, and the fill takes its place in the same colour rather than letting
  // the new screen's background show first. Going back, it fades out as the bar rises and the tab
  // bar reappears beneath it.
  val fillIn = remember { Animatable(if (fillTarget > 0.dp) 1f else 0f) }

  LaunchedEffect(fillTarget > 0.dp) {
    if (fillTarget > 0.dp) {
      // Quick enough to finish before the tab bar's screen is swapped out; over the tab bar in
      // its own colour, this reads as the tab bar's icons fading out.
      if (settled) fillIn.animateTo(1f, tween(fillInMillis)) else fillIn.snapTo(1f)
    } else {
      fillIn.snapTo(0f)
    }
  }

  val fillAlpha = remember(fillTarget) {
    derivedStateOf {
      if (fillTarget > 0.dp) return@derivedStateOf fillIn.value
      val to = if (shown.fill > 0.dp) 1f else 0f
      val old = previous ?: return@derivedStateOf to
      val from = if (old.fill > 0.dp) 1f else 0f
      val distance = shown.offset - old.offset
      val progress =
        if (distance == 0.dp) 1f else ((contentOffset.value - old.offset) / distance).coerceIn(0f, 1f)

      from + (to - from) * progress
    }
  }

  LaunchedEffect(placement) {
    if (placement == shown) {
      return@LaunchedEffect
    }

    if (!settled) {
      shown = placement
      contentOffset.snapTo(placement.offset)

      return@LaunchedEffect
    }

    previous = shown.copy(offset = contentOffset.value)
    shown = placement
    // The new route is usually still being laid out when its place arrives; starting a couple of
    // frames later keeps that first busy frame from swallowing the start of the motion.
    repeat(2) { withFrameNanos {} }
    contentOffset.animateTo(placement.offset, spring(stiffness = Spring.StiffnessMediumLow))
    previous = null
  }

  LaunchedEffect(transition.currentState, transition.isRunning) {
    if (!transition.isRunning && transition.currentState == transition.targetState) {
      onSettled(transition.currentState)
    }
  }

  // Covers what lies below the bar while the player is open, such as the tab bar. Opening, it
  // fades in with the growing player. Closing, it fades out evenly over the whole shrink rather
  // than on a spring, which would drop most of it at once, so the tab bar comes back gradually and
  // is whole as the mini player lands.
  val stripAlpha by transition.animateFloat(
    transitionSpec = {
      if (targetState) {
        spring(stiffness = Spring.StiffnessMediumLow)
      } else {
        tween(durationMillis = stripOutMillis, easing = LinearEasing)
      }
    },
    label = "strip"
  ) { open -> if (open) 1f else 0f }

  // Opening, it is in the open player's colour from the start. Closing, its colour follows the
  // player's background to the bar's, which the tab bar shares, so while it fades nothing shows a
  // colour of its own: the band matches the shrinking player, and only the tab bar's icons come
  // back through it.
  val stripColor by transition.animateColor(
    transitionSpec = { if (targetState) snap() else spring(stiffness = Spring.StiffnessMediumLow) },
    label = "strip-colour"
  ) { open -> if (open) colors.surface else colors.surfaceContainer }

  // The player fades in as it first appears, such as open after playback starts from a book's
  // page, once it has drawn, so the fade is seen rather than spent before anything shows.
  // Closed, it fades out the same way before it is taken away.
  val appear = remember { Animatable(0f) }
  // Each fade says when it is done, so the app changes what lies behind only once it is covered,
  // and takes the player away only once it is gone, however slowly animations run.
  LaunchedEffect(props.vanishing) {
    if (props.vanishing) {
      appear.animateTo(0f, tween(appearMillis))
      onFaded(false)
    } else {
      repeat(appearFrames) { withFrameNanos { } }
      appear.animateTo(1f, tween(appearMillis))
      onFaded(true)
    }
  }

  Box(Modifier.fillMaxSize().graphicsLayer { alpha = appear.value }) {
    // Drawn beneath the player: from the bar down to the bottom, in the bar's colour.
    if (fillAlpha.value > 0f) {
      Box(
        Modifier
          .align(Alignment.BottomCenter)
          .fillMaxWidth()
          .height(contentOffset.value)
          .graphicsLayer { alpha = fillAlpha.value }
          .background(colors.surfaceContainer)
      )
    }

    // Drawn beneath the player, so its content can run over it; it still covers the tab bar below
    // while it fades.
    if (restingOffset > 0.dp && (stripAlpha > 0f || transition.targetState)) {
      // A Surface, so taps meant for the open player never reach the tab bar underneath.
      Surface(
        color = stripColor,
        modifier = Modifier
          .align(Alignment.BottomCenter)
          .fillMaxWidth()
          .height(restingOffset)
          .graphicsLayer { alpha = stripAlpha }
      ) {}
    }

    SharedTransitionLayout(Modifier.fillMaxSize()) {
      transition.AnimatedContent(
        modifier = Modifier.fillMaxSize(),
        transitionSpec = { fadeIn() togetherWith fadeOut() }
      ) { isExpanded ->
        // The layout on its way in is drawn above the one on its way out.
        val entering = isExpanded == transition.targetState
        val clip = OverlayClip(RectangleShape)

        // The outgoing background stays opaque until the end while the incoming one fades in over
        // it, so the colour changes without the background ever turning see-through.
        val background = Modifier.sharedBounds(
          rememberSharedContentState(backgroundKey),
          this@AnimatedContent,
          enter = fadeIn(),
          // Barely changes, so it stays solid; the incoming background covers it as it fades in.
          exit = fadeOut(targetAlpha = 0.99f),
          resizeMode = SharedTransitionScope.ResizeMode.RemeasureToBounds,
          zIndexInOverlay = if (entering) 1f else 0f,
          clipInOverlayDuringTransition = clip
        )

        // The layout on its way out fades quickly rather than riding the container the whole way:
        // the mini player's title and buttons are gone early as it grows, and the full player's
        // bar early as it shrinks. The cover, shared between the two, still travels.
        val content = Modifier.sharedBounds(
          rememberSharedContentState(contentKey),
          this@AnimatedContent,
          enter = fadeIn(),
          exit = fadeOut(tween(outgoingFadeMillis)),
          resizeMode = SharedTransitionScope.ResizeMode.RemeasureToBounds,
          zIndexInOverlay = if (entering) 3f else 2f,
          clipInOverlayDuringTransition = clip
        )

        CompositionLocalProvider(
          LocalPlayerSharedScopes provides PlayerSharedScopes(this@SharedTransitionLayout, this@AnimatedContent)
        ) {
          if (isExpanded) {
            Box(Modifier.fillMaxSize()) {
              // Only the background stops above the tab bar, where the strip takes over; the
              // player's content uses the whole height. A Surface, so touches on the player's
              // empty areas never reach the page behind.
              Surface(
                color = colors.surface,
                modifier = Modifier.fillMaxSize().padding(bottom = restingOffset).then(background)
              ) {}
              Box(content.fillMaxSize()) {
                expandedSlot?.renderSlot()
              }
            }
          } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
              Box(
                Modifier
                  .padding(bottom = contentOffset.value)
                  .fillMaxWidth()
                  .height(barHeight)
              ) {
                Surface(color = colors.surfaceContainer, modifier = background.matchParentSize()) {}
                Box(content.fillMaxSize()) {
                  collapsedSlot?.renderSlot()
                }
              }
            }
          }
        }
      }
    }

  }
}

@OptimizedComposeProps
data class PlayerFadeProps(
  // Unused; props records need a field.
  val unused: Boolean = false
) : ComposeProps

/**
 * Places the content where it will be once the player's transition ends, whatever the morphing
 * container around it does, so it only fades and never slides with it.
 */
private fun Modifier.pinnedToFinalPlace(scope: LookaheadScope) = with(scope) {
  approachLayout(
    isMeasurementApproachInProgress = { false },
    isPlacementApproachInProgress = { true }
  ) { measurable, constraints ->
    val placeable = measurable.measure(constraints)

    layout(placeable.width, placeable.height) {
      val here = coordinates

      if (here == null) {
        placeable.place(0, 0)
      } else {
        val final = lookaheadScopeCoordinates.localLookaheadPositionOf(here)
        val now = lookaheadScopeCoordinates.localPositionOf(here, Offset.Zero)

        placeable.place((final.x - now.x).roundToInt(), (final.y - now.y).roundToInt())
      }
    }
  }
}

/**
 * Content of the player that fades rather than travelling with the morphing container, such as
 * the controls below the cover: it appears once the container is well on its way, and fades out
 * over the first part of the close, the reverse of opening. Outside the expanding player it is drawn as it is.
 */
@Composable
fun FunctionalComposableScope.PlayerFadeContent(@Suppress("UNUSED_PARAMETER") props: PlayerFadeProps) {
  val scopes = LocalPlayerSharedScopes.current
  val alpha = scopes?.visibility?.transition?.animateFloat(
    transitionSpec = {
      if (targetState == EnterExitState.Visible) {
        tween(durationMillis = 200, delayMillis = 200)
      } else {
        // The reverse of opening: gone within the first part of the close while everything else
        // keeps moving.
        tween(durationMillis = 200)
      }
    },
    label = "player-fade"
  ) { state -> if (state == EnterExitState.Visible) 1f else 0f }

  Box(
    Modifier
      .fillMaxWidth()
      .then(if (scopes != null) Modifier.pinnedToFinalPlace(scopes.shared) else Modifier)
      .graphicsLayer {
        val shown = alpha?.value ?: 1f

        this.alpha = shown
        // A short rise into place as it fades in, and a short drop as it fades out.
        translationY = (1f - shown) * fadeTravel.toPx()
      }
  ) {
    Children(UIComposableScope(boxScope = this@Box))
  }
}
