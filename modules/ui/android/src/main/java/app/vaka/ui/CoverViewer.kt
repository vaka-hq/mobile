package app.vaka.ui

import android.view.WindowManager
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import coil3.compose.AsyncImage
import coil3.memory.MemoryCache
import coil3.request.ImageRequest
import coil3.request.crossfade
import coil3.size.Scale
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max

/** The Material Symbols close glyph the rest of the app uses. */
private val closeSymbol = ImageVector.Builder(
  defaultWidth = 24.dp,
  defaultHeight = 24.dp,
  viewportWidth = 960f,
  viewportHeight = 960f
).addPath(
  PathParser().parsePathString(
    "M256,760L200,704L424,480L200,256L256,200L480,424L704,200L760,256L536,480L760,704L704,760L480,536L256,760Z"
  ).toNodes(),
  fill = SolidColor(Color.Black)
).build()

/** Large enough to stay sharp when zoomed in on any phone, without decoding a huge original. */
private const val viewerPixels = 2048

private const val maxScale = 5f
private const val doubleTapScale = 2.5f

/** Pinched out below this and let go, the viewer closes rather than springing back. */
private const val closeScale = 0.8f

/**
 * A cover on its own over a black backdrop, opened by tapping it. It pinches and double-taps to
 * zoom and pans while zoomed; it closes with Back, its close button, a tap beside the image, a
 * swipe up or down, or a pinch out below its fitted size. The image already on screen stands in
 * while the larger one loads.
 */
@Composable
fun CoverViewer(
  uri: String,
  description: String,
  closeLabel: String,
  // The cover's width over height, when known, so panning stops at its edges from the start.
  aspect: Float?,
  // The cover on the page, shown at once while the larger one loads.
  placeholderKey: MemoryCache.Key?,
  onClose: () -> Unit
) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val closed by rememberUpdatedState(onClose)
  val appear = remember { Animatable(0f) }
  var closing by remember { mutableStateOf(false) }
  var scale by remember { mutableFloatStateOf(1f) }
  var offset by remember { mutableStateOf(Offset.Zero) }
  // How far a swipe has carried the cover up or down, at its fitted size.
  var drag by remember { mutableFloatStateOf(0f) }
  var imageAspect by remember { mutableStateOf(aspect) }
  var settle by remember { mutableStateOf<Job?>(null) }

  val close: () -> Unit = {
    if (!closing) {
      closing = true
      scope.launch {
        appear.animateTo(0f, tween(200, easing = FastOutSlowInEasing))
        closed()
      }
    }
  }

  LaunchedEffect(Unit) {
    appear.animateTo(1f, tween(250, easing = FastOutSlowInEasing))
  }

  val request = remember(context, uri, placeholderKey) {
    ImageRequest.Builder(context)
      .data(uri)
      .size(viewerPixels, viewerPixels)
      .scale(Scale.FIT)
      .placeholderMemoryCacheKey(placeholderKey)
      .crossfade(200)
      .build()
  }

  Dialog(
    onDismissRequest = close,
    properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
  ) {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window

    DisposableEffect(window) {
      // The backdrop is drawn here, so it can fade with a swipe; the system bars' icons are light
      // over it whatever the theme.
      window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
      window?.setWindowAnimations(0)
      window?.let {
        WindowCompat.getInsetsController(it, it.decorView).apply {
          isAppearanceLightStatusBars = false
          isAppearanceLightNavigationBars = false
        }
      }
      onDispose { }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
      val density = LocalDensity.current
      val touchSlop = LocalViewConfiguration.current.touchSlop
      val width = with(density) { maxWidth.toPx() }
      val height = with(density) { maxHeight.toPx() }
      val centre = Offset(width / 2f, height / 2f)
      val dismissDistance = with(density) { 120.dp.toPx() }

      // The image's size at its fitted scale.
      val fitted = imageAspect?.takeIf { it.isFinite() && it > 0f }?.let {
        if (it > width / height) Offset(width, width / it) else Offset(height * it, height)
      } ?: Offset(width, height)

      // Panning stops where the image's edge meets the screen's, on each axis on its own.
      fun bounded(value: Offset, at: Float) = Offset(
        value.x.coerceIn(-max(0f, (fitted.x * at - width) / 2f), max(0f, (fitted.x * at - width) / 2f)),
        value.y.coerceIn(-max(0f, (fitted.y * at - height) / 2f), max(0f, (fitted.y * at - height) / 2f))
      )

      fun settleTo(targetScale: Float, targetOffset: Offset) {
        settle?.cancel()
        val fromScale = scale
        val fromOffset = offset
        val fromDrag = drag
        settle = scope.launch {
          animate(0f, 1f, animationSpec = tween(250, easing = FastOutSlowInEasing)) { progress, _ ->
            scale = fromScale + (targetScale - fromScale) * progress
            offset = fromOffset + (targetOffset - fromOffset) * progress
            drag = fromDrag * (1f - progress)
          }
        }
      }

      // Zooms to a scale keeping the point under `focus` where it is.
      fun zoomedOffset(focus: Offset, from: Float, to: Float, current: Offset): Offset {
        val toFocus = focus - centre
        return toFocus - (toFocus - current) * (to / from)
      }

      // The backdrop thins as a swipe or a pinch out carries the cover away.
      val away = maxOf(abs(drag) / (dismissDistance * 3f), (1f - scale).coerceAtLeast(0f) * 2f).coerceIn(0f, 1f)

      Box(
        Modifier
          .fillMaxSize()
          .graphicsLayer { alpha = appear.value * (1f - away) }
          .background(Color.Black)
      )

      AsyncImage(
        model = request,
        contentDescription = description.ifBlank { null },
        contentScale = ContentScale.Fit,
        onSuccess = { state ->
          val size = state.painter.intrinsicSize
          if (size.width > 0f && size.height > 0f) imageAspect = size.width / size.height
        },
        modifier = Modifier
          .fillMaxSize()
          .pointerInput(width, height, fitted) {
            awaitEachGesture {
              awaitFirstDown(requireUnconsumed = false)
              settle?.cancel()
              var transforming = false
              var swiping = false
              var travel = Offset.Zero

              do {
                val event = awaitPointerEvent()
                val fingers = event.changes.count { it.pressed }
                val zoom = event.calculateZoom()
                val pan = event.calculatePan()

                if (closing) break

                if (!transforming && !swiping) {
                  travel += pan
                  if (fingers > 1 || scale > 1.01f) {
                    transforming = fingers > 1 || travel.getDistance() > touchSlop
                  } else if (abs(travel.y) > touchSlop && abs(travel.y) > abs(travel.x)) {
                    swiping = true
                  }
                }

                if (transforming) {
                  val focus = event.calculateCentroid(useCurrent = false)
                  val next = (scale * zoom).coerceIn(closeScale / 2f, maxScale)
                  val moved = if (focus.isSpecified()) zoomedOffset(focus, scale, next, offset) else offset
                  scale = next
                  offset = bounded(moved + pan, max(1f, next))
                } else if (swiping) {
                  drag += pan.y
                }

                if (transforming || swiping) {
                  event.changes.forEach { if (it.positionChanged()) it.consume() }
                }
              } while (event.changes.any { it.pressed })

              when {
                closing -> Unit
                swiping && abs(drag) > dismissDistance -> close()
                swiping -> settleTo(scale, offset)
                transforming && scale < closeScale -> close()
                transforming && scale < 1f -> settleTo(1f, Offset.Zero)
                else -> Unit
              }
            }
          }
          .pointerInput(width, height, fitted) {
            detectTapGestures(
              onDoubleTap = { at ->
                if (scale > 1.01f) {
                  settleTo(1f, Offset.Zero)
                } else {
                  settleTo(doubleTapScale, bounded(zoomedOffset(at, 1f, doubleTapScale, Offset.Zero), doubleTapScale))
                }
              },
              onTap = { at ->
                // A tap beside the image closes the viewer; one on it does nothing.
                val image = (fitted * scale) / 2f
                val from = centre + offset
                if (abs(at.x - from.x) > image.x || abs(at.y - from.y) > image.y) close()
              }
            )
          }
          .graphicsLayer {
            val opening = 0.92f + 0.08f * appear.value
            scaleX = scale * opening
            scaleY = scale * opening
            translationX = offset.x
            translationY = offset.y + drag
            alpha = appear.value
          }
      )

      IconButton(
        onClick = close,
        modifier = Modifier
          .align(Alignment.TopStart)
          .safeDrawingPadding()
          .padding(4.dp)
          .graphicsLayer { alpha = appear.value * (1f - away) }
      ) {
        Icon(closeSymbol, contentDescription = closeLabel.ifBlank { null }, tint = Color.White)
      }
    }
  }
}

private fun Offset.isSpecified() = x.isFinite() && y.isFinite()
