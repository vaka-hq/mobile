package expo.modules.androidcomponents

import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.ShortNavigationBar
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import expo.modules.ui.findChildSlotView
import expo.modules.ui.renderSlot

@OptimizedComposeProps
data class ShortNavigationBarProps(
  val selectedIndex: Int = 0,
  val firstLabel: String = "",
  val secondLabel: String = "",
  val thirdLabel: String = ""
) : ComposeProps

@OptimizedRecord
data class TabSelectedEvent(
  @Field val index: Int
) : Record

/** The Material 3 Expressive navigation bar for the app's two or three destinations. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun FunctionalComposableScope.ShortNavigationBarContent(
  props: ShortNavigationBarProps,
  onTabSelected: (Int) -> Unit
) {
  // Registers this scope so icon slots that change after the first composition recompose the bar.
  Children(UIComposableScope(), filter = { false })

  val labels = listOf(props.firstLabel, props.secondLabel, props.thirdLabel)
  val icons = listOf(
    findChildSlotView(view, "firstIcon"),
    findChildSlotView(view, "secondIcon"),
    findChildSlotView(view, "thirdIcon"),
  )

  ShortNavigationBar {
    labels.forEachIndexed { index, label ->
      // A destination without a label is not shown, so the bar can hold two.
      if (label.isEmpty()) {
        return@forEachIndexed
      }

      ShortNavigationBarItem(
        selected = props.selectedIndex == index,
        onClick = { onTabSelected(index) },
        icon = { icons[index]?.renderSlot() },
        label = { Text(label) }
      )
    }
  }
}
