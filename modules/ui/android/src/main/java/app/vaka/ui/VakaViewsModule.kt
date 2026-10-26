package app.vaka.ui

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.ui.ExpoUIView

/**
 * The Compose views Expo UI lacks. They stay on the Expo Modules definition DSL, as Expo UI's own
 * views do: Expo Modules 2.0 has no views yet. The functions are `VakaUIModule`'s.
 */
class VakaViewsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VakaViews")

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

    ExpoUIView<SheetRowsProps>("SheetRowsView") {
      val onRowPress by Event<ButtonGroupPressEvent>()

      Content { props ->
        SheetRowsContent(props) { index -> onRowPress(ButtonGroupPressEvent(index)) }
      }
    }

    ExpoUIView<PlaybackSliderProps>("PlaybackSliderView") {
      val onValueChange by Event<PlaybackValueEvent>()
      val onValueChangeFinished by Event<Unit>()

      Content { props ->
        PlaybackSliderContent(
          props,
          { value -> onValueChange(PlaybackValueEvent(value)) },
          { onValueChangeFinished(Unit) }
        )
      }
    }

    ExpoUIView<PlaybackLineProps>("PlaybackLineView") {
      Content { props ->
        PlaybackLineContent(props)
      }
    }

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
      Content { _ ->
        PlayerFadeContent()
      }
    }

    ExpoUIView<ViewportBoxProps>("ViewportBoxView") {
      Content { _ ->
        ViewportBoxContent()
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
