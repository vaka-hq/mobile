package app.vaka.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import expo.modules.ui.findChildSlotView
import expo.modules.ui.renderSlot

@OptimizedComposeProps
data class SheetRowsProps(
  // One entry per row in each list; an empty string leaves that part of the row out.
  val keys: List<String> = emptyList(),
  val leading: List<String> = emptyList(),
  val headlines: List<String> = emptyList(),
  val supporting: List<String> = emptyList(),
  val details: List<String> = emptyList(),
  // The row standing out, such as the chapter playing; its leading text gives way to the
  // `selectedLeading` slot when there is one.
  val selected: Int = -1,
  // The row to bring into view when the list first shows.
  val initialIndex: Int = 0
) : ComposeProps

/**
 * A sheet's lazy list of connected cards drawn from plain data rather than a view per row, so a
 * list of hundreds, such as a long book's chapters, opens at once. The cards match `CardItem`'s:
 * 16 dp from the edges, 2 dp apart, round at the ends of the list. It opens with the row before
 * `initialIndex` at the top and has the sheet open far enough to show that row.
 */
@Composable
fun FunctionalComposableScope.SheetRowsContent(props: SheetRowsProps, onPress: (Int) -> Unit) {
  // Registers this scope so a slot that changes after the first composition recomposes.
  Children(UIComposableScope(), filter = { false })

  val count = props.headlines.size
  val state = rememberLazyListState()
  var positioned by remember { mutableStateOf(false) }
  var listCoordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
  val reveal = LocalSheetReveal.current
  val selectedLeading = findChildSlotView(view, "selectedLeading")
  val colors = MaterialTheme.colorScheme
  // A lazy list fails on a repeated key, so rows fall back to their places should any repeat.
  val keyed = remember(props.keys, count) {
    props.keys.size == count && props.keys.toSet().size == count
  }

  LaunchedEffect(props.initialIndex, count) {
    if (!positioned && count > 0 && props.initialIndex in 0 until count) {
      state.scrollToItem((props.initialIndex - 1).coerceAtLeast(0))
      positioned = true
      withFrameNanos {}
      val item = state.layoutInfo.visibleItemsInfo.firstOrNull { it.index == props.initialIndex }
      val coordinates = listCoordinates
      if (item != null && coordinates != null) {
        reveal?.invoke(coordinates, (item.offset + item.size).toFloat())
      }
    }
  }

  LazyColumn(
    modifier = Modifier.fillMaxWidth().onGloballyPositioned { listCoordinates = it },
    state = state,
    verticalArrangement = Arrangement.spacedBy(2.dp),
    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp)
  ) {
    itemsIndexed(
      props.headlines,
      key = { index, _ -> if (keyed) props.keys[index] else index }
    ) { index, headline ->
      val selected = index == props.selected
      val onCard = if (selected) colors.onSecondaryContainer else colors.onSurfaceVariant
      val top = if (index == 0) 20.dp else 4.dp
      val bottom = if (index == count - 1) 20.dp else 4.dp
      val leading = props.leading.getOrNull(index).orEmpty()
      val supporting = props.supporting.getOrNull(index).orEmpty()
      val detail = props.details.getOrNull(index).orEmpty()
      val icon = selectedLeading.takeIf { selected }

      ListItem(
        headlineContent = {
          Text(headline, maxLines = 2, overflow = TextOverflow.Ellipsis)
        },
        modifier = Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(top, top, bottom, bottom))
          .clickable { onPress(index) },
        supportingContent = supporting.takeIf { it.isNotEmpty() }?.let {
          { Text(it, color = onCard, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        },
        leadingContent = if (icon != null || leading.isNotEmpty()) {
          {
            // A fixed column keeps titles aligned across one- and two-digit numbers.
            Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) {
              if (icon != null) {
                icon.renderSlot()
              } else {
                Text(leading, color = onCard, style = MaterialTheme.typography.labelLarge)
              }
            }
          }
        } else {
          null
        },
        trailingContent = detail.takeIf { it.isNotEmpty() }?.let {
          { Text(it, color = onCard, style = MaterialTheme.typography.labelMedium) }
        },
        colors = ListItemDefaults.colors(
          containerColor = if (selected) colors.secondaryContainer else colors.surfaceContainerHigh
        )
      )
    }
  }
}
