package expo.modules.androidcomponents

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.currentRecomposeScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ComposableScope
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.ExpoComposeView
import expo.modules.kotlin.views.OptimizedComposeProps
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned

@OptimizedComposeProps
data class SheetListProps(
  // The item to bring into view when the list first shows, such as the chapter playing.
  val initialIndex: MutableState<Int> = mutableStateOf(0),
  // The list is at least this tall in dp, so a short list still opens the sheet this far.
  val minHeight: MutableState<Float> = mutableStateOf(0f)
) : ComposeProps

/**
 * A sheet's lazy list of connected cards, 16 dp from the edges and 2 dp apart, opened with a given
 * item in view: the item before it stays visible above, so the reader sees where they are.
 */
@SuppressLint("ViewConstructor")
class SheetListView(context: Context, appContext: AppContext) :
  ExpoComposeView<SheetListProps>(context, appContext) {
  override val props = SheetListProps()

  private val composableChildCount: MutableIntState = mutableIntStateOf(0)

  override fun onViewAdded(child: View?) {
    super.onViewAdded(child)
    composableChildCount.intValue = childCount
  }

  override fun onViewRemoved(child: View?) {
    super.onViewRemoved(child)
    composableChildCount.intValue = childCount
  }

  @Composable
  override fun ComposableScope.Content() {
    recomposeScope = currentRecomposeScope
    val state = rememberLazyListState()
    val count = composableChildCount.intValue
    val initialIndex = props.initialIndex.value
    var positioned by remember { mutableStateOf(false) }
    // Height changes animate only once the list has settled, so its first layout, when every
    // item arrives, does not resize the sheet frame by frame.
    var settled by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
      delay(600)
      settled = true
    }
    var listCoordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val reveal = LocalSheetReveal.current

    // Props and children can arrive after the first composition; scroll once both are there,
    // then have the sheet open far enough to show the item, as near the end of a long list it
    // cannot scroll to the top.
    LaunchedEffect(initialIndex, count) {
      if (!positioned && count > 0 && initialIndex in 0 until count) {
        state.scrollToItem((initialIndex - 1).coerceAtLeast(0))
        positioned = true
        withFrameNanos {}
        val item = state.layoutInfo.visibleItemsInfo.firstOrNull { it.index == initialIndex }
        val coordinates = listCoordinates
        if (item != null && coordinates != null) {
          reveal?.invoke(coordinates, (item.offset + item.size).toFloat())
        }
      }
    }

    LazyColumn(
      modifier = Modifier
        .fillMaxWidth()
        .heightIn(min = props.minHeight.value.coerceAtLeast(0f).dp)
        // A shorter list, such as after deleting, eases to its new height.
        .then(if (settled) Modifier.animateContentSize() else Modifier)
        .onGloballyPositioned { listCoordinates = it },
      state = state,
      verticalArrangement = Arrangement.spacedBy(2.dp),
      contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp)
    ) {
      for (index in 0..<count) {
        val child = getChildAt(index) as? ExpoComposeView<*> ?: continue
        // Keyed by view, so removing one card animates it out and the rest into place.
        item(key = System.identityHashCode(child)) {
          Box(Modifier.animateItem()) {
            with(this@Content) {
              with(child) {
                Content()
              }
            }
          }
        }
      }
    }
  }
}
