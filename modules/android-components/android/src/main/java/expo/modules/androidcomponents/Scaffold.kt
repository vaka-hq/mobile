package expo.modules.androidcomponents

import android.graphics.Color
import androidx.compose.foundation.layout.Box
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.lerp
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScaffoldDefaults
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.style.TextOverflow
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.kotlin.views.OptimizedComposeProps
import expo.modules.ui.UIComposableScope
import expo.modules.ui.composeOrNull
import expo.modules.ui.findChildSlotView
import expo.modules.ui.isSlotView
import expo.modules.ui.renderSlot

// Shares the Scaffold's scroll behavior with the app bar rendered in its topBar slot, so the
// separate native views drive one Material collapse animation.
@OptIn(ExperimentalMaterial3Api::class)
val LocalTopAppBarScrollBehavior = staticCompositionLocalOf<TopAppBarScrollBehavior?> { null }

@OptimizedComposeProps
data class ScaffoldProps(
  // One of: "none", "pinned", "enterAlways", "exitUntilCollapsed".
  val scrollBehavior: String = "none",
  // Screens above the app's navigation bar must not reserve the system navigation inset again.
  val bottomInset: Boolean = true,
  val snackbarId: Double = 0.0,
  val snackbarMessage: String = "",
  // Replaces the `surface` background, such as transparent where a surface behind already paints.
  val containerColor: Color? = null
) : ComposeProps

@OptimizedComposeProps
class HeaderAppBarProps : ComposeProps

@OptimizedComposeProps
data class AppBarProps(
  val title: String = "",
  val containerColor: Color? = null,
  /** The title centred on the bar, as Material's centre-aligned small app bar has it. */
  val centered: Boolean = false
) : ComposeProps

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FunctionalComposableScope.ScaffoldContent(props: ScaffoldProps, onSnackbarDismiss: () -> Unit) {
  val topBarSlotView = findChildSlotView(view, "topBar")
  val bottomBarSlotView = findChildSlotView(view, "bottomBar")
  val floatingActionButtonSlotView = findChildSlotView(view, "floatingActionButton")
  val snackbarHostState = remember { SnackbarHostState() }

  LaunchedEffect(props.snackbarId) {
    if (props.snackbarId > 0.0 && props.snackbarMessage.isNotEmpty()) {
      snackbarHostState.showSnackbar(
        message = props.snackbarMessage,
        withDismissAction = true,
        duration = SnackbarDuration.Short
      )
      onSnackbarDismiss()
    }
  }

  // Whether the bar may slide away, which a gated list below decides from its content.
  val collapseAllowed = remember { mutableStateOf(true) }

  val scrollBehavior: TopAppBarScrollBehavior? = when (props.scrollBehavior) {
    "pinned" -> TopAppBarDefaults.pinnedScrollBehavior()
    "enterAlways" -> TopAppBarDefaults.enterAlwaysScrollBehavior(canScroll = { collapseAllowed.value })
    "exitUntilCollapsed" -> TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    else -> null
  }

  CompositionLocalProvider(
    LocalTopAppBarScrollBehavior provides scrollBehavior,
    LocalCollapseAllowed provides collapseAllowed
  ) {
  Scaffold(
    modifier = if (scrollBehavior != null) {
      Modifier.nestedScroll(scrollBehavior.nestedScrollConnection)
    } else {
      Modifier
    },
    // Material 3 screens sit on `surface`; `background` is the legacy role.
    containerColor = props.containerColor.composeOrNull ?: MaterialTheme.colorScheme.surface,
    contentWindowInsets = if (props.bottomInset) {
      ScaffoldDefaults.contentWindowInsets
    } else {
      ScaffoldDefaults.contentWindowInsets.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top)
    },
    topBar = {
      CompositionLocalProvider(LocalTopAppBarScrollBehavior provides scrollBehavior) {
        topBarSlotView?.renderSlot()
      }
    },
    bottomBar = {
      bottomBarSlotView?.renderSlot()
    },
    floatingActionButton = {
      floatingActionButtonSlotView?.renderSlot()
    },
    snackbarHost = {
      SnackbarHost(hostState = snackbarHostState)
    }
  ) { innerPadding ->
    Box(
      modifier = Modifier
        .fillMaxSize()
        .padding(innerPadding)
        .consumeWindowInsets(innerPadding)
    ) {
      Children(UIComposableScope(), filter = { !isSlotView(it) })
    }
  }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FunctionalComposableScope.TopAppBarContent(props: AppBarProps, large: Boolean) {
  // Slot lookups read the view hierarchy directly. Registering this scope through `Children` (which
  // draws nothing here) makes slots attached after the first composition, such as actions that
  // appear once a screen has loaded, recompose the bar.
  Children(UIComposableScope(), filter = { false })

  val titleSlotView = findChildSlotView(view, "title")
  val navigationIconSlotView = findChildSlotView(view, "navigationIcon")
  val actionsSlotView = findChildSlotView(view, "actions")
  val colors = TopAppBarDefaults.topAppBarColors(
    containerColor = props.containerColor.composeOrNull ?: MaterialTheme.colorScheme.surface
  )
  val title: @Composable () -> Unit = {
    if (titleSlotView != null) {
      titleSlotView.renderSlot()
    } else {
      Text(props.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
  }

  if (large) {
    LargeTopAppBar(
      title = title,
      navigationIcon = { navigationIconSlotView?.renderSlot() },
      actions = { actionsSlotView?.renderSlot() },
      colors = colors,
      scrollBehavior = LocalTopAppBarScrollBehavior.current
    )
  } else if (props.centered) {
    CenterAlignedTopAppBar(
      title = title,
      navigationIcon = { navigationIconSlotView?.renderSlot() },
      actions = { actionsSlotView?.renderSlot() },
      colors = colors,
      scrollBehavior = LocalTopAppBarScrollBehavior.current
    )
  } else {
    TopAppBar(
      title = title,
      navigationIcon = { navigationIconSlotView?.renderSlot() },
      actions = { actionsSlotView?.renderSlot() },
      colors = colors,
      scrollBehavior = LocalTopAppBarScrollBehavior.current
    )
  }
}

/**
 * A top bar made of whatever it holds, such as a title row with filter chips below, or a search
 * field with its chips: Material's small app bar with no height of its own, so it is as tall as
 * its content. With the Scaffold's enter-always behaviour it slides away as a list scrolls down
 * and returns on any scroll up, all of it together, and takes the scrolled container colour once
 * content passes under it. Its content runs edge to edge; chips bring their own padding.
 */
/**
 * How far the header over a screen's list has taken its scrolled colour, from 0 to 1, eased as the
 * bar's own colour is, so what sits in it, such as a search field, follows both ways.
 */
val LocalHeaderRaised = compositionLocalOf { 0f }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FunctionalComposableScope.HeaderAppBarContent() {
  val behavior = LocalTopAppBarScrollBehavior.current
  // As the bar decides its own colour: raised once content passes under it.
  val raisedTarget by remember(behavior) {
    derivedStateOf { if ((behavior?.state?.overlappedFraction ?: 0f) > 0.01f) 1f else 0f }
  }
  val raised by animateFloatAsState(
    raisedTarget,
    MaterialTheme.motionScheme.defaultEffectsSpec(),
    label = "header-raised"
  )
  // Material's title slot keeps 16 dp at its start and 8 dp at its end; the content takes them.
  val gutters = Modifier
    .clipToBounds()
    .layout { measurable, constraints ->
      val start = 16.dp.roundToPx()
      val end = 8.dp.roundToPx()
      val child = measurable.measure(constraints.offset(horizontal = start + end))
      layout(constraints.constrainWidth(child.width - start - end), child.height) {
        child.placeRelative(-start, 0)
      }
    }

  TopAppBar(
    modifier = gutters,
    title = {
      CompositionLocalProvider(LocalHeaderRaised provides raised) {
        Column(Modifier.fillMaxWidth()) {
          Children(UIComposableScope(), filter = { !isSlotView(it) })
        }
      }
    },
    colors = TopAppBarDefaults.topAppBarColors(),
    expandedHeight = 0.dp,
    contentPadding = PaddingValues(0.dp),
    windowInsets = TopAppBarDefaults.windowInsets,
    scrollBehavior = behavior
  )
}

@OptimizedComposeProps
class HeaderFieldProps : ComposeProps

/**
 * The pill a search field sits in: `surfaceContainerHigh` at rest, and `surfaceBright` in a header
 * that has taken its scrolled colour, as the reference app's search field has it, easing between
 * the two as the header does.
 */
@Composable
fun FunctionalComposableScope.HeaderFieldContent() {
  val scheme = MaterialTheme.colorScheme
  val surface = lerp(scheme.surfaceContainerHigh, scheme.surfaceBright, LocalHeaderRaised.current)

  Box(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(28.dp))
      .background(surface)
  ) {
    Children(UIComposableScope(), filter = { !isSlotView(it) })
  }
}
