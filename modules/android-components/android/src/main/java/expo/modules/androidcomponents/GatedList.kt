package expo.modules.androidcomponents

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.currentRecomposeScope
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import expo.modules.kotlin.views.ComposableScope
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.ExpoComposeView
import expo.modules.kotlin.views.OptimizedComposeProps

/**
 * Whether the screen's top bar may slide away: the Scaffold asks this before collapsing it, and a
 * gated list sets it from whether its content overflows. Null outside a Scaffold.
 */
val LocalCollapseAllowed = staticCompositionLocalOf<MutableState<Boolean>?> { null }

@OptimizedRecord
data class GatedListPadding(
  @Field val start: Int = 0,
  @Field val top: Int = 0,
  @Field val end: Int = 0,
  @Field val bottom: Int = 0
) : Record

@OptimizedComposeProps
data class GatedListProps(
  val contentPadding: MutableState<GatedListPadding?> = mutableStateOf(null),
  /** Space between items, in dp. */
  val spacing: MutableState<Double> = mutableStateOf(0.0)
) : ComposeProps

/**
 * A lazy list, one item per child as Expo UI's LazyColumn has it, that decides whether the top
 * bar above it may slide away. It may only when the content overflows the list as tall as it is
 * with the bar shown in full, so collapsing the bar, which makes the list taller, can never make
 * the content fit again and bounce the bar back; content that fits keeps the bar in place. Content
 * that overflows gets room at its foot as tall as the bar, so scrolling it always carries it under
 * the bar, which then takes its scrolled colour.
 */
@SuppressLint("ViewConstructor")
class GatedListView(context: Context, appContext: AppContext) :
  ExpoComposeView<GatedListProps>(context, appContext) {
  override val props = GatedListProps()

  private val childTotal: MutableIntState = mutableIntStateOf(0)

  override fun onViewAdded(child: View?) {
    super.onViewAdded(child)
    childTotal.intValue = childCount
  }

  override fun onViewRemoved(child: View?) {
    super.onViewRemoved(child)
    childTotal.intValue = childCount
  }

  @OptIn(ExperimentalMaterial3Api::class)
  @Composable
  override fun ComposableScope.Content() {
    recomposeScope = currentRecomposeScope
    val padding = props.contentPadding.value
    val list = rememberLazyListState()
    val density = LocalDensity.current
    val bar = LocalTopAppBarScrollBehavior.current?.state
    val gate = LocalCollapseAllowed.current
    // The list's own padding above and below, in pixels. The room added at the foot is left out
    // of what is measured, so adding it can never change whether the content overflows.
    val basePadding = with(density) { ((padding?.top ?: 0) + (padding?.bottom ?: 0)).dp.roundToPx() }

    val overflowing by remember(list, bar, basePadding) {
      derivedStateOf { list.overflows(basePadding, bar?.heightOffset ?: 0f) }
    }

    // While the content overflows, only as much room at its foot as it lacks to pass fully under
    // the bar once the bar has slid away, and a little more so it does: a list long enough on its
    // own gets none. It is measured while every item is laid out, and kept while scrolling hides
    // some; a list that never shows all of them at once is long enough.
    val margin = with(density) { passUnder.dp.toPx() }
    var extraBottom by remember(list) { mutableFloatStateOf(0f) }
    val shortfall by remember(list, bar, basePadding) {
      derivedStateOf { list.shortfall(basePadding, bar?.heightOffset ?: 0f, bar?.heightOffsetLimit ?: 0f, margin) }
    }

    SideEffect {
      shortfall?.let { extraBottom = it }
    }

    SideEffect { gate?.value = overflowing }

    LaunchedEffect(overflowing) {
      // Content that fits brings the bar back, and nothing is left scrolled under it.
      if (!overflowing && bar != null) {
        bar.heightOffset = 0f
        bar.contentOffset = 0f
      }
    }

    DisposableEffect(gate) { onDispose { gate?.value = true } }

    val scope = this@Content

    LazyColumn(
      state = list,
      modifier = Modifier.fillMaxSize(),
      verticalArrangement = Arrangement.spacedBy(props.spacing.value.dp),
      contentPadding = PaddingValues(
        start = (padding?.start ?: 0).dp,
        top = (padding?.top ?: 0).dp,
        end = (padding?.end ?: 0).dp,
        bottom = (padding?.bottom ?: 0).dp + with(density) { extraBottom.toDp() }
      )
    ) {
      val count = childTotal.intValue
      for (index in 0..<count) {
        val child = getChildAt(index) as? ExpoComposeView<*> ?: continue
        item {
          with(scope) {
            with(child) {
              Content()
            }
          }
        }
      }
    }
  }
}

/** How far past the bar's edge content passes once the bar has slid away, in dp. */
private const val passUnder = 16f

/**
 * The room the content lacks at its foot to pass fully under the bar once the bar has slid away,
 * in pixels: zero when it fits the list with the bar shown, or is long enough already; null while
 * not every item is laid out, when it cannot be measured.
 */
private fun LazyListState.shortfall(
  basePadding: Int,
  barOffset: Float,
  barLimit: Float,
  margin: Float
): Float? {
  val info = layoutInfo
  val visible = info.visibleItemsInfo
  val viewport = info.viewportEndOffset - info.viewportStartOffset
  if (viewport <= 0 || info.totalItemsCount == 0 || visible.size < info.totalItemsCount) return null
  val content = visible.maxOf { it.offset + it.size } - visible.minOf { it.offset } + basePadding
  val expandedViewport = viewport + barOffset.coerceAtMost(0f)
  if (content <= expandedViewport) return 0f
  val barHeight = -barLimit.coerceAtMost(0f)
  return (expandedViewport + barHeight + margin - content).coerceAtLeast(0f)
}

/**
 * Whether the content, with the list's own padding, is taller than the list with the bar shown in
 * full, as the reference app measures it: comparing with the bar shown means sliding it away,
 * which makes the list taller, can never flip the answer and bounce the bar back.
 */
private fun LazyListState.overflows(basePadding: Int, barOffset: Float): Boolean {
  val info = layoutInfo
  val visible = info.visibleItemsInfo
  val viewport = info.viewportEndOffset - info.viewportStartOffset
  if (viewport <= 0 || info.totalItemsCount == 0 || visible.isEmpty()) return false
  if (visible.size < info.totalItemsCount) return true
  val contentStart = visible.minOf { it.offset }
  val contentEnd = visible.maxOf { it.offset + it.size }
  val expandedViewport = viewport + barOffset.coerceAtMost(0f)
  return contentEnd - contentStart + basePadding > expandedViewport
}
