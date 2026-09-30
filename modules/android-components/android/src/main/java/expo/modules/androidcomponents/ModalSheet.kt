package expo.modules.androidcomponents

import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.material3.rememberStandardBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import expo.modules.kotlin.views.AsyncFunctionHandle
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.Dp

@OptimizedComposeProps
data class ModalSheetProps(
  // The opening stop as a share of the screen, for content taller than it.
  val initialHeightFraction: Float = 0.5f,
  // Shorter content opens at its own height.
  val wrapContent: Boolean = true
) : ComposeProps

/**
 * The app's one bottom sheet, ported from the reference app's PartialSheetDialog: it opens at
 * content height up to its opening stop and expands to full height as its content is scrolled.
 * Back, the scrim and `hide` share one native dismissal path, and the dialog is removed as soon
 * as the sheet is hidden, before JavaScript acknowledges it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FunctionalComposableScope.ModalSheetContent(
  props: ModalSheetProps,
  hide: AsyncFunctionHandle<Unit>,
  onDismiss: () -> Unit
) {
  val state = rememberStandardBottomSheetState(initialValue = SheetValue.Hidden, skipHiddenState = false)
  val scope = rememberCoroutineScope()

  hide.handle {
    try {
      withContext(scope.coroutineContext) { state.hide() }
    } catch (_: CancellationException) {
    }
  }

  OpenModalSheet(state)
  PartialSheetDialog(
    state,
    onDismiss,
    initialHeightFraction = props.initialHeightFraction,
    wrapContent = props.wrapContent
  ) { Children(UIComposableScope()) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OpenModalSheet(state: SheetState) {
  LaunchedEffect(Unit) {
    snapshotFlow { state.hasExpandedState }.first { it }
    // Short content may only have an expanded anchor at its natural height.
    state.show()
  }
}

/**
 * Lets content in a sheet ask it to open far enough to show something, such as the chapter
 * playing: pass the coordinates it is measured in and the bottom edge to show. The sheet only
 * ever grows for this, and only as far as needed.
 */
val LocalSheetReveal = compositionLocalOf<((LayoutCoordinates, Float) -> Unit)?> { null }

/** Room left below something revealed, so it does not sit flush against the screen's edge. */
private val revealMargin = 16.dp

/** The sheet's top edge covers this share of the screen when the backdrop starts to fill. */
private const val SHEET_TOP_RAMP_START = 0.85f

/** 0 until the sheet covers [SHEET_TOP_RAMP_START] of the viewport, rising to 1 at the top. */
private fun sheetTopProgress(offset: Float, viewportHeight: Float): Float {
  if (viewportHeight <= 0f) return 0f
  val coverage = 1f - offset / viewportHeight
  return ((coverage - SHEET_TOP_RAMP_START) / (1f - SHEET_TOP_RAMP_START)).coerceIn(0f, 1f)
}

/** Material's 32 x 4 dp handle, as a picture only: no click, ripple or handle semantics. */
@Composable
private fun StaticSheetHandle() {
  Box(
    modifier = Modifier
      .fillMaxWidth()
      .padding(top = 22.dp, bottom = 12.dp)
      .clearAndSetSemantics {},
    contentAlignment = Alignment.Center
  ) {
    Box(
      Modifier
        .size(width = 32.dp, height = 4.dp)
        .background(MaterialTheme.colorScheme.onSurfaceVariant, MaterialTheme.shapes.extraLarge)
    )
  }
}

/** Short sheets wrap their content; longer ones open at the configured stop and can expand. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PartialSheetDialog(
  state: SheetState,
  onDismiss: () -> Unit,
  containerColor: Color = BottomSheetDefaults.ContainerColor,
  initialHeightFraction: Float = 0.5f,
  wrapContent: Boolean = true,
  content: @Composable ColumnScope.() -> Unit
) {
  val scope = rememberCoroutineScope()
  val onClosed by rememberUpdatedState(onDismiss)
  var visible by remember(state) { mutableStateOf(true) }
  var closing by remember(state) { mutableStateOf(false) }
  // Measured inside the dialog; the sheet's offset is relative to this viewport.
  var viewportHeight by remember(state) { mutableIntStateOf(0) }

  LaunchedEffect(state) {
    var opened = false
    snapshotFlow { Triple(state.currentValue, state.targetValue, state.isAnimationRunning) }
      .collect { (current, target, animating) ->
        if (current != SheetValue.Hidden || target != SheetValue.Hidden) opened = true
        if (opened && current == SheetValue.Hidden && target == SheetValue.Hidden && !animating && visible) {
          // Release the dialog window locally; React may take longer to acknowledge the event.
          visible = false
          onClosed()
        }
      }
  }

  if (!visible) return

  val dismiss: () -> Unit = {
    if (!closing) {
      closing = true
      scope.launch {
        try {
          state.hide()
        } finally {
          closing = false
        }
      }
    }
  }

  Dialog(
    onDismissRequest = dismiss,
    properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
  ) {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window

    DisposableEffect(window) {
      // Compose draws the one scrim; window dimming and exit effects must not outlive it.
      window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
      window?.setWindowAnimations(0)
      onDispose { }
    }

    BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
      val density = LocalDensity.current
      var contentHeight by remember { mutableIntStateOf(0) }
      val initialHeight = maxHeight * initialHeightFraction
      val basePeek = if (wrapContent && contentHeight > 0) {
        minOf(initialHeight, with(density) { contentHeight.toDp() })
      } else {
        initialHeight
      }
      // Grown to reveal something the content asked to show.
      val revealed = remember { Animatable(0.dp, Dp.VectorConverter) }
      var sheetCoordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
      val navigationBar = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
      val sheetMax = maxHeight - WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
      val reveal: (LayoutCoordinates, Float) -> Unit = reveal@{ coordinates, bottom ->
        val sheet = sheetCoordinates ?: return@reveal
        if (!sheet.isAttached || !coordinates.isAttached) return@reveal
        val offset = sheet.localPositionOf(coordinates, Offset(0f, bottom)).y
        val needed = with(density) { offset.toDp() } + navigationBar + revealMargin
        val content = with(density) { contentHeight.toDp() }

        if (needed >= minOf(content, sheetMax) - revealMargin) {
          // All of it is needed: the sheet's own expanded stop is exactly that. Raising the
          // partial stop to the full height instead would leave Material with one stop, which it
          // cannot settle on.
          scope.launch { state.expand() }
        } else if (needed > basePeek && needed > revealed.targetValue) {
          // Set at once: the sheet's own opening animation carries it there, and animating the
          // stop would re-measure the whole sheet on every frame.
          scope.launch { revealed.snapTo(needed) }
        }
      }
      val peekHeight = maxOf(basePeek, revealed.value)
      val peekPixels = with(density) { peekHeight.toPx() }
      val scrimColor = BottomSheetDefaults.ScrimColor
      val backingColor = MaterialTheme.colorScheme.surface

      Box(
        Modifier.matchParentSize().drawBehind {
          val offset = if (state.hasExpandedState) state.requireOffset() else viewportHeight.toFloat()
          val fraction = if (peekPixels > 0f) ((viewportHeight - offset) / peekPixels).coerceIn(0f, 1f) else 0f
          // Near the top the whole backdrop fades to the surface, so the rounded corners reveal
          // surface rather than content, painted before the scrim.
          val edgeFill = sheetTopProgress(offset, viewportHeight.toFloat())
          if (edgeFill > 0f) drawRect(color = backingColor, alpha = edgeFill)
          drawRect(scrimColor.copy(alpha = scrimColor.alpha * fraction))
        }
      )

      BottomSheetScaffold(
        modifier = Modifier
          .fillMaxSize()
          .statusBarsPadding()
          .onSizeChanged { viewportHeight = it.height },
        scaffoldState = rememberBottomSheetScaffoldState(bottomSheetState = state),
        sheetPeekHeight = peekHeight,
        sheetDragHandle = null,
        sheetShadowElevation = 0.dp,
        sheetContainerColor = containerColor,
        containerColor = Color.Transparent,
        sheetContent = {
          val contentModifier = if (wrapContent) {
            Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top)
          } else {
            Modifier.fillMaxSize()
          }

          Column(
            contentModifier
              .onSizeChanged { contentHeight = it.height }
              .onGloballyPositioned { sheetCoordinates = it }
              .navigationBarsPadding()
          ) {
            StaticSheetHandle()
            CompositionLocalProvider(LocalSheetReveal provides reveal) {
              content()
            }
          }
        }
      ) {
        Box(
          Modifier
            .fillMaxSize()
            .clickable(
              interactionSource = remember { MutableInteractionSource() },
              indication = null,
              onClick = dismiss
            )
        )
      }
    }
  }
}
