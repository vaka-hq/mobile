package app.vaka.ui

import android.net.Uri
import android.os.Build
import android.view.RoundedCorner
import android.view.View
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.ui.ExpoUIView

class VakaUIModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VakaUI")

    // The radius of the screen's bottom corners in dp, or 0 where Android does not report it.
    Function("bottomCornerRadius") {
      val activity = appContext.currentActivity
      if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@Function 0.0
      }

      val corner = activity.display?.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT)
        ?: return@Function 0.0

      corner.radius / activity.resources.displayMetrics.density.toDouble()
    }

    // Whether React Native handles Back; off at the root screen, so Android can animate back to
    // the home screen. False while no activity is attached yet, for the caller to try again.
    Function("setReactNativeBack") { enabled: Boolean ->
      val activity = appContext.currentActivity as? com.facebook.react.ReactActivity ?: return@Function false
      setReactNativeBack(activity, enabled)
      // Stack screens get predictive back wherever React Native would handle Back.
      activity.runOnUiThread {
        StackEnter.register(activity)
        StackBack.of(activity).setWanted(enabled)
      }
      true
    }

    // While the app takes Back for itself, a back swipe previews nothing.
    Function("setBackPreviewBlocked") { blocked: Boolean ->
      val activity = appContext.currentActivity as? com.facebook.react.ReactActivity ?: return@Function false
      activity.runOnUiThread { StackBack.of(activity).setBlocked(blocked) }
      true
    }

    // A closing screen keeps its last frame through the stack's exit transition.
    AsyncFunction("freezeScreen") { tag: Int, promise: Promise ->
      val activity = appContext.currentActivity
      val view = appContext.findView<View>(tag)
      if (activity == null || view == null) return@AsyncFunction promise.resolve(false)
      ScreenFreeze.freeze(activity, view) { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)

    // A predictive back removes its screen natively first; such a screen has nothing to freeze.
    Function("takeNativeDismissal") { StackBack.takeNativeDismissal() }

    // A committed back swipe is about to dismiss the top screen natively.
    Events("onNativeDismissal")

    OnCreate {
      StackBack.onDismissing = { sendEvent("onNativeDismissal", emptyMap<String, Any>()) }
    }

    OnDestroy {
      StackBack.onDismissing = null
    }

    AsyncFunction("thawScreen") { tag: Int ->
      appContext.findView<View>(tag)?.let { ScreenFreeze.thaw(it) }
    }.runOnQueue(Queues.MAIN)

    // An EPUB's contents with where each part starts, from 0 to 1, as JSON: the same parts and
    // places the reader reports on opening it, read without opening it, such as once it is
    // downloaded, so a place heard in its audiobook can be found in it before the reader opens.
    AsyncFunction("readBookSections") { uri: String ->
      val file = java.io.File(Uri.parse(uri).path ?: throw IllegalArgumentException("No file to read"))
      val book = EpubBook.open(file)
      try {
        val sections = org.json.JSONArray()
        book.toc.forEach { entry ->
          book.resolve(entry.href)?.let { pos ->
            sections.put(org.json.JSONObject().put("label", entry.label).put("fraction", book.fraction(pos).toDouble()))
          }
        }
        sections.toString()
      } finally {
        book.close()
      }
    }

    ExpoUIView<ScaffoldProps>("ScaffoldView") {
      val onSnackbarDismiss by Event<Unit>()

      Content { props ->
        ScaffoldContent(props) { onSnackbarDismiss(Unit) }
      }
    }

    ExpoUIView<AppBarProps>("TopAppBarView") {
      Content { props ->
        TopAppBarContent(props, large = false)
      }
    }

    View(GatedListView::class)

    ExpoUIView<StepDotsProps>("StepDotsView") {
      Content { props ->
        StepDotsContent(props)
      }
    }

    ExpoUIView<HeaderFieldProps>("HeaderFieldView") {
      Content { _ ->
        HeaderFieldContent()
      }
    }

    ExpoUIView<BodyCentreProps>("BodyCentreView") {
      Content { _ ->
        BodyCentreContent()
      }
    }

    ExpoUIView<HeaderAppBarProps>("HeaderAppBarView") {
      Content { _ ->
        HeaderAppBarContent()
      }
    }

    ExpoUIView<AppBarProps>("LargeTopAppBarView") {
      Content { props ->
        TopAppBarContent(props, large = true)
      }
    }

    ExpoUIView<ConnectedActionsProps>("ConnectedActionsView") {
      val onActionPress by Event<ButtonGroupPressEvent>()

      Content { props ->
        ConnectedActionsContent(props) { index -> onActionPress(ButtonGroupPressEvent(index)) }
      }
    }

    ExpoUIView<CoverImageProps>("CoverImageView") {
      val onImageError by Event<Unit>()

      Content { props ->
        CoverImageContent(props) { onImageError(Unit) }
      }
    }

    ExpoUIView<ExpandingPlayerProps>("ExpandingPlayerView") {
      val onSettled by Event<PlayerSettledEvent>()
      val onFaded by Event<PlayerFadedEvent>()

      Content { props ->
        ExpandingPlayerContent(
          props,
          { expanded -> onSettled(PlayerSettledEvent(expanded)) },
          { shown -> onFaded(PlayerFadedEvent(shown)) }
        )
      }
    }

    View(SheetListView::class)

    ExpoUIView<ModalSheetProps>("ModalSheetView") {
      val hide by AsyncFunction()
      val onDismissRequest by Event<Unit>()

      Content { props ->
        ModalSheetContent(props, hide) { onDismissRequest(Unit) }
      }
    }

    ExpoUIView<ConnectedButtonGroupProps>("ConnectedButtonGroupView") {
      val onItemPress by Event<ButtonGroupPressEvent>()
      val onItemLongPress by Event<ButtonGroupPressEvent>()

      Content { props ->
        ConnectedButtonGroupContent(
          props,
          { index -> onItemPress(ButtonGroupPressEvent(index)) },
          { index -> onItemLongPress(ButtonGroupPressEvent(index)) }
        )
      }
    }

    ExpoUIView<PlayPauseButtonProps>("PlayPauseButtonView") {
      val onPress by Event<Unit>()

      Content { props ->
        PlayPauseButtonContent(props) { onPress(Unit) }
      }
    }

    ExpoUIView<PlayerFadeProps>("PlayerFadeView") {
      Content { props ->
        PlayerFadeContent(props)
      }
    }

    ExpoUIView<ViewportBoxProps>("ViewportBoxView") {
      Content { props ->
        ViewportBoxContent(props)
      }
    }

    ExpoUIView<FitColumnProps>("FitColumnView") {
      Content { props ->
        FitColumnContent(props)
      }
    }

    ExpoUIView<SideRevealProps>("SideRevealView") {
      Content { props ->
        SideRevealContent(props)
      }
    }

    ExpoUIView<BookViewProps>("BookView") {
      val send by AsyncFunction<String>()
      val onMessage by Event<BookMessage>()

      Content { _ ->
        BookViewContent(send) { data -> onMessage(BookMessage(data)) }
      }
    }

        ExpoUIView<ShortNavigationBarProps>("ShortNavigationBarView") {
      val onTabSelected by Event<TabSelectedEvent>()

      Content { props ->
        ShortNavigationBarContent(props) { index -> onTabSelected(TabSelectedEvent(index)) }
      }
    }
  }
}
