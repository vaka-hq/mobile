package expo.modules.androidcomponents

import android.graphics.Color
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import coil3.size.Precision
import coil3.size.Scale
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.composeOrNull

@OptimizedComposeProps
data class CoverImageProps(
  val uri: String = "",
  val description: String = "",
  // The square slot the cover is centred in, in dp.
  val dimension: Double = 64.0,
  val cornerRadius: Double = 4.0,
  // The cover's dominant colour, shown until the image fades in.
  val color: Color? = null,
  // Width over height when the source reports it; otherwise learned from the loaded image.
  val aspect: Double = 0.0,
  // Inside the expanding player, covers with the same key travel between its two layouts.
  val sharedKey: String = "",
  // The slot takes the cover's own shape instead of a square, for a cover shown on its own.
  val hug: Boolean = false,
  // The cover takes the largest size that fits the space it is given, in its own shape;
  // `dimension` is then unused.
  val fill: Boolean = false
) : ComposeProps

/** Large enough for the full player's cover on any phone. */
private const val sharedCoverPixels = 1024

/**
 * A book cover at its own proportions inside a square slot, or a slot of its own shape with `hug`,
 * or, with `fill`, as large as the space it is given allows. When the source gives the cover's
 * shape, a tile in its colour holds the place and the image fades in over it; a cover of unknown
 * shape draws nothing until it loads and then fades in at its size. Sizes never animate, since the
 * view can compose once with default props before the real ones arrive. Images decode at the
 * displayed size, never at the source's resolution, except shared covers, which use one size.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun CoverImageContent(props: CoverImageProps, onImageError: () -> Unit) {
  var loadedAspect by remember(props.uri) { mutableStateOf<Float?>(null) }
  val knownAspect = props.aspect.toFloat().takeIf { it.isFinite() && it > 0f }

  if (props.fill) {
    BoxWithConstraints(contentAlignment = Alignment.Center) {
      val aspect = knownAspect ?: loadedAspect ?: 1f
      // A tall cover is as tall as it may be unless that makes it too wide, and a wide one the
      // other way round.
      val byWidth = if (aspect < 1f) maxWidth / aspect else maxWidth
      val byHeight = if (!constraints.hasBoundedHeight) byWidth else if (aspect < 1f) maxHeight else maxHeight * aspect
      CoverImageBody(props, minOf(byWidth, byHeight), knownAspect, loadedAspect, { loadedAspect = it }, onImageError)
    }
  } else {
    val dimension = props.dimension.toFloat().let { if (it.isFinite() && it > 0) it else 64f }.dp
    CoverImageBody(props, dimension, knownAspect, loadedAspect, { loadedAspect = it }, onImageError)
  }
}

@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
private fun CoverImageBody(
  props: CoverImageProps,
  dimension: Dp,
  knownAspect: Float?,
  loadedAspect: Float?,
  onAspect: (Float) -> Unit,
  onImageError: () -> Unit
) {
  val context = LocalContext.current
  // A shared cover decodes at one size in both of its places, so the same cached image is on
  // screen throughout the transition instead of reloading at each size.
  // A cover fitted to its space decodes at one size too, so fitting it again, such as when room
  // opens for the mini player below, never reloads the image.
  val pixels = if (props.sharedKey.isNotBlank() || props.fill) {
    sharedCoverPixels
  } else {
    with(LocalDensity.current) { dimension.roundToPx() }.coerceIn(1, 2048)
  }
  val aspect = knownAspect ?: loadedAspect ?: 1f
  val width = if (aspect >= 1f) dimension else dimension * aspect
  val height = if (aspect >= 1f) dimension / aspect else dimension
  // A placeholder only where its shape is right; otherwise the loaded image simply fades in.
  val placeholder = if (knownAspect != null) {
    props.color.composeOrNull ?: MaterialTheme.colorScheme.surfaceContainerHighest
  } else {
    ComposeColor.Transparent
  }
  val request = remember(context, props.uri, pixels) {
    ImageRequest.Builder(context)
      .data(props.uri.ifBlank { null })
      .size(pixels, pixels)
      .scale(Scale.FIT)
      .precision(Precision.EXACT)
      .crossfade(300)
      .build()
  }

  val scopes = LocalPlayerSharedScopes.current
  val shared = if (scopes != null && props.sharedKey.isNotBlank()) {
    with(scopes.shared) {
      // Both places' covers are scaled to the moving bounds, so the cover grows on the way out
      // of the bar and shrinks on the way back rather than snapping to its new size. They show
      // the same image, so neither fades; they are drawn above the crossfading layouts.
      Modifier.sharedBounds(
        rememberSharedContentState(props.sharedKey),
        scopes.visibility,
        enter = EnterTransition.None,
        exit = ExitTransition.None,
        resizeMode = SharedTransitionScope.ResizeMode.scaleToBounds(ContentScale.Fit, Alignment.Center),
        zIndexInOverlay = 4f
      )
    }
  } else {
    Modifier
  }

  Box(
    modifier = if (props.hug) shared.size(width, height) else shared.size(dimension),
    contentAlignment = Alignment.Center
  ) {
    AsyncImage(
      model = request,
      contentDescription = props.description.ifBlank { null },
      modifier = Modifier
        .size(width, height)
        .clip(RoundedCornerShape(props.cornerRadius.toFloat().dp))
        .background(placeholder),
      alignment = Alignment.Center,
      // Fit while the shape is still unknown, so the first frame never crops the cover.
      contentScale = if (knownAspect != null || loadedAspect != null) ContentScale.Crop else ContentScale.Fit,
      onSuccess = { state ->
        val size = state.painter.intrinsicSize
        if (size.width > 0f && size.height > 0f) {
          onAspect(size.width / size.height)
        }
      },
      onError = { onImageError() }
    )
  }
}
