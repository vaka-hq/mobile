package app.vaka.ui

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.SystemClock
import android.util.TypedValue
import android.view.MotionEvent
import android.view.RoundedCorner
import android.view.VelocityTracker
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.animation.AnimationUtils
import android.view.animation.DecelerateInterpolator
import android.view.animation.PathInterpolator
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.graphics.ColorUtils
import androidx.dynamicanimation.animation.FloatValueHolder
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import com.swmansion.rnscreens.Screen
import com.swmansion.rnscreens.ScreenStack
import com.swmansion.rnscreens.ScreenStackFragmentWrapper
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Predictive back between the screens of a stack, drawn as Android draws it between the pages of
 * the system Settings app: WindowManager Shell's DefaultCrossActivityBackAnimation (Android 17).
 * The page shrinks to 85% (against the right edge from a left-edge swipe), follows the finger
 * vertically and keeps the window's corner radius; the page under it waits behind a scrim, shifted
 * left, and both run the system's post-commit spring and 450 ms emphasized move. Each constant is
 * Shell's.
 *
 * react-native-screens keeps only the top screen of a stack attached, so the gesture attaches the
 * one below it for the preview; a committed back then dismisses the top screen natively, which
 * tells React to pop it, and a cancelled one detaches the screen again. Back without a preview (a
 * back button or key, Android 13, or nothing the stack can pop) goes on to React Native, which
 * closes the screen with the stack's transition.
 */
internal class StackBack private constructor(private val activity: ComponentActivity) :
  OnBackPressedCallback(false) {

  private var wanted = false
  private var blocked = false
  private var preview: Preview? = null
  private var commit: ValueAnimator? = null

  /** One gesture: the stack, its top screen and the one it reveals. */
  private inner class Preview(
    val stack: ScreenStack,
    val top: ScreenStackFragmentWrapper,
    val below: ScreenStackFragmentWrapper,
    val edge: Int,
    val touchY: Float,
  ) {
    val bounds = RectF(0f, 0f, stack.width.toFloat(), stack.height.toFloat())
    val corner = windowCornerRadius()
    val startClosing = RectF()
    val targetClosing = RectF()
    val currentClosing = RectF()
    val startEntering = RectF()
    val targetEntering = RectF()
    val currentEntering = RectF()
    val velocity: VelocityTracker = VelocityTracker.obtain()
    var downTime = -1L
    var progress = 0f
    var flingScale = 100f
    val night =
      activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
        Configuration.UI_MODE_NIGHT_YES
    val maxScrim = if (night) 0.8f else 0.2f
    val background = backgroundColor()
    val savedBackground: Drawable? = stack.background
    val scrim = ColorDrawable(Color.BLACK)

    val closing: View? get() = top.fragment.view
    val entering: View? get() = below.fragment.view

    init {
      // preparePreCommitClosingRectMovement
      startClosing.set(bounds)
      targetClosing.set(startClosing)
      targetClosing.scaleCentered(0.85f)
      if (edge != BackEventCompat.EDGE_RIGHT) {
        targetClosing.offset(startClosing.right - targetClosing.right - dp(MARGIN_DP), 0f)
      }
      // preparePreCommitEnteringRectMovement
      startEntering.set(startClosing)
      startEntering.scaleCentered(
        min(0.95f, (startClosing.height() - 2f * corner) / startEntering.height()),
      )
      startEntering.offset(-max(startEntering.width() * 0.14999998f, dp(ENTERING_OFFSET_DP)), 0f)
      targetEntering.set(startEntering)
      targetEntering.scaleCentered(0.85f)
    }
  }

  fun setWanted(enabled: Boolean) {
    wanted = enabled
    isEnabled = enabled
  }

  fun setBlocked(value: Boolean) {
    blocked = value
  }

  override fun handleOnBackStarted(backEvent: BackEventCompat) {
    commit?.end()
    cancelPreview()
    // A back button or key closes the screen with the stack's transition, as in Settings.
    if (blocked || backEvent.swipeEdge == EDGE_NONE) return
    val (stack, top, below) = target() ?: return
    if (!attach(stack, top, below)) return
    val next = Preview(stack, top, below, backEvent.swipeEdge, backEvent.touchY)
    preview = next
    begin(next)
    progressed(next, 0f, backEvent.touchY, AnimationUtils.currentAnimationTimeMillis())
  }

  override fun handleOnBackProgressed(backEvent: BackEventCompat) {
    val current = preview ?: return
    // Shell times its velocity by the event's frame; the app's androidx.activity predates it.
    progressed(current, backEvent.progress, backEvent.touchY, AnimationUtils.currentAnimationTimeMillis())
  }

  override fun handleOnBackCancelled() {
    cancelPreview()
  }

  override fun handleOnBackPressed() {
    val current = preview
    if (current == null) return forwardToReactNative()
    preview = null
    committed(current)
  }

  /** Back for React Native's own callback, the next one in the dispatcher. */
  private fun forwardToReactNative() {
    isEnabled = false
    try {
      activity.onBackPressedDispatcher.onBackPressed()
    } finally {
      isEnabled = wanted
    }
  }

  /**
   * The stack a back would pop, as React Navigation picks it: the deepest shown stack on the path
   * of top screens that holds more than one screen. A sheet, a transparent screen or a dismissal
   * already under way gets no preview.
   */
  private fun target(): Triple<ScreenStack, ScreenStackFragmentWrapper, ScreenStackFragmentWrapper>? {
    var found: Triple<ScreenStack, ScreenStackFragmentWrapper, ScreenStackFragmentWrapper>? = null

    fun visit(view: View) {
      if (view is ScreenStack) {
        if (!view.isShown) return
        val top = view.topScreen ?: return
        val wrappers = view.fragments
        val index = wrappers.indexOfFirst { it.screen === top }
        val below = wrappers.take(max(index, 0)).lastOrNull {
          it.screen.activityState != Screen.ActivityState.INACTIVE
        }
        val wrapper = wrappers.getOrNull(index)
        if (wrapper != null && below != null && view.width > 0 && poppable(wrapper)) {
          found = Triple(view, wrapper, below)
        }
        visit(top)
        return
      }
      if (view is ViewGroup) for (i in 0 until view.childCount) visit(view.getChildAt(i))
    }

    visit(activity.findViewById(android.R.id.content) ?: return null)
    return found
  }

  private fun poppable(top: ScreenStackFragmentWrapper): Boolean =
    top.screen.stackPresentation == Screen.StackPresentation.PUSH &&
      !top.isTranslucent() &&
      top.fragment.isResumed &&
      top.fragment.view?.isAttachedToWindow == true

  /** Puts the revealed screen back in the stack, under the top one, without a transition. */
  private fun attach(
    stack: ScreenStack,
    top: ScreenStackFragmentWrapper,
    below: ScreenStackFragmentWrapper,
  ): Boolean =
    try {
      if (!below.fragment.isAdded) {
        StackEnter.bypass = true
        try {
          top.fragment.parentFragmentManager
            .beginTransaction()
            .setReorderingAllowed(true)
            .add(stack.id, below.fragment)
            .commitNowAllowingStateLoss()
        } finally {
          StackEnter.bypass = false
        }
      }
      top.fragment.view?.bringToFront()
      below.fragment.view != null
    } catch (_: IllegalStateException) {
      false
    }

  private fun detach(current: Preview) {
    try {
      if (current.below.fragment.isAdded && current.stack.topScreen === current.top.screen) {
        current.top.fragment.parentFragmentManager
          .beginTransaction()
          .setReorderingAllowed(true)
          .remove(current.below.fragment)
          .commitNowAllowingStateLoss()
      }
    } catch (_: IllegalStateException) {
    }
  }

  private fun begin(current: Preview) {
    current.stack.background = ColorDrawable(scrimmed(current, current.maxScrim))
    for (view in listOfNotNull(current.closing, current.entering)) clip(view, current.corner)
    current.entering?.foreground = current.scrim.also { it.alpha = alpha255(current.maxScrim) }
  }

  /** CrossActivityBackAnimation's progress callback, for the views of the two screens. */
  private fun progressed(current: Preview, raw: Float, touchY: Float, frame: Long) {
    // A stack update while the finger is down can take the revealed screen away again.
    if (!current.below.fragment.isAdded) attach(current.stack, current.top, current.below)
    val progress = GESTURE.getInterpolation(raw)
    current.progress = progress
    current.currentClosing.lerp(current.startClosing, current.targetClosing, progress)
    val height = current.bounds.height()
    val moved = touchY - current.touchY
    val half = height / 2f
    val shift =
      max(0f, (height - current.currentClosing.height()) / 2f - dp(MARGIN_DP)) *
        VERTICAL.getInterpolation(min(half, abs(moved)) / half) *
        (if (moved < 0f) -1f else 1f)
    current.currentClosing.offset(0f, shift)
    place(current, current.closing, current.currentClosing, 1f, fling = false)
    current.currentEntering.lerp(current.startEntering, current.targetEntering, progress)
    current.currentEntering.offset(0f, shift)
    place(current, current.entering, current.currentEntering, 1f, fling = false)

    if (current.downTime == -1L) current.downTime = frame
    val event = MotionEvent.obtain(current.downTime, frame, MotionEvent.ACTION_MOVE, progress, 0f, 0)
    current.velocity.addMovement(event)
    event.recycle()
  }

  /** onGestureCommitted and DefaultCrossActivityBackAnimation's post-commit animation. */
  private fun committed(current: Preview) {
    // Said before the post-commit animation, so the screen lets go of its removal in JavaScript
    // before the stack dismisses it here.
    onDismissing?.invoke()
    current.velocity.computeCurrentVelocity(1000)
    val velocity = current.velocity.xVelocity
    current.startClosing.set(current.currentClosing)
    current.startEntering.set(current.currentEntering)
    current.targetEntering.set(current.bounds)
    current.targetClosing.set(current.bounds)
    current.targetClosing.offset(current.currentClosing.left + dp(ENTERING_OFFSET_DP), 0f)

    val sideways =
      current.edge == BackEventCompat.EDGE_LEFT || current.edge == BackEventCompat.EDGE_RIGHT
    var fling = velocity * 100f * 0.14999998f * (if (sideways) 2f else 1f)
    if (current.progress < 0.1f && fling < 120f) fling = 120f
    val scale = FloatValueHolder(100f)
    SpringAnimation(scale, 100f)
      .setStartVelocity(-fling.coerceIn(0f, 1000f))
      .setStartValue(100f)
      .apply { spring = SpringForce(100f).setStiffness(200f).setDampingRatio(0.75f) }
      .addUpdateListener { _, value, _ -> current.flingScale = value }
      .start()

    val blocker = blockTouches()
    commit = ValueAnimator.ofFloat(1f, 0f).setDuration(POST_COMMIT_MS).apply {
      addUpdateListener { animator ->
        val fraction = animator.animatedFraction
        val scrim = (1f - fraction) * current.maxScrim
        current.stack.background = ColorDrawable(scrimmed(current, scrim))
        current.scrim.alpha = alpha255(scrim)
        val moved = EMPHASIZED.getInterpolation(fraction)
        current.currentClosing.lerp(current.startClosing, current.targetClosing, moved)
        place(current, current.closing, current.currentClosing, max(1f - 5f * fraction, 0f), fling = true)
        current.currentEntering.lerp(current.startEntering, current.targetEntering, moved)
        place(current, current.entering, current.currentEntering, 1f, fling = true)
      }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          commit = null
          (blocker.parent as? ViewGroup)?.removeView(blocker)
          current.closing?.alpha = 0f
          restore(current)
          // No exit transition: the closing screen is already gone from view.
          current.top.screen.stackAnimation = Screen.StackAnimation.NONE
          nativeDismissalAt = SystemClock.uptimeMillis()
          current.stack.dismiss(current.top)
          current.closing?.let(::reset)
        }
      })
      start()
    }
  }

  private fun cancelPreview() {
    val current = preview ?: return
    preview = null
    restore(current)
    current.closing?.let(::reset)
    detach(current)
  }

  private fun restore(current: Preview) {
    current.velocity.recycle()
    current.stack.background = current.savedBackground
    current.entering?.let {
      it.foreground = null
      reset(it)
    }
  }

  /** applyTransform: the screen scaled to the rectangle's width from its top left corner. */
  private fun place(current: Preview, view: View?, rect: RectF, alpha: Float, fling: Boolean) {
    view ?: return
    val shown = RectF(rect)
    if (fling) shown.scaleCentered(min(current.flingScale / 100f, 1f))
    val scale = shown.width() / current.bounds.width()
    view.pivotX = 0f
    view.pivotY = 0f
    view.scaleX = scale
    view.scaleY = scale
    view.translationX = shown.left
    view.translationY = shown.top
    view.alpha = alpha
  }

  private fun clip(view: View, radius: Float) {
    view.outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        outline.setRoundRect(0, 0, view.width, view.height, radius)
      }
    }
    view.clipToOutline = true
  }

  private fun reset(view: View) {
    view.scaleX = 1f
    view.scaleY = 1f
    view.translationX = 0f
    view.translationY = 0f
    view.alpha = 1f
    view.clipToOutline = false
    view.outlineProvider = ViewOutlineProvider.BACKGROUND
  }

  /** The surface behind the revealed screen with the scrim over it, as one colour. */
  private fun scrimmed(current: Preview, scrim: Float): Int =
    ColorUtils.blendARGB(current.background, Color.BLACK, scrim)

  private fun alpha255(value: Float) = (value * 255f + 0.5f).toInt().coerceIn(0, 255)

  /** Taps wait while the committed screen leaves, as they do over a closing activity. */
  @SuppressLint("ClickableViewAccessibility")
  private fun blockTouches(): View {
    val decor = activity.window.decorView as ViewGroup
    val blocker = View(activity).apply { setOnTouchListener { _, _ -> true } }
    decor.addView(blocker, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    return blocker
  }

  /**
   * The entering task's background colour in Shell; here the window's, which the app keeps at
   * its screen background.
   */
  private fun backgroundColor(): Int {
    (activity.window.decorView.background as? ColorDrawable)?.let { return it.color }
    val value = TypedValue()
    return if (activity.theme.resolveAttribute(android.R.attr.colorBackground, value, true)) value.data
    else Color.WHITE
  }

  /** ScreenDecorationsUtils.getWindowCornerRadius from the same framework resources. */
  private fun windowCornerRadius(): Float {
    val system = Resources.getSystem()
    fun dimen(name: String): Float {
      val id = system.getIdentifier(name, "dimen", "android")
      return if (id == 0) 0f else system.getDimension(id)
    }
    val supports = system.getIdentifier("config_supportsRoundedCornersOnWindows", "bool", "android")
    if (supports != 0 && !system.getBoolean(supports)) return 0f
    if (supports == 0) {
      // Without the framework resources, the display's own corners.
      if (Build.VERSION.SDK_INT < 31) return 0f
      val insets = activity.window.decorView.rootWindowInsets ?: return 0f
      val top = insets.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)?.radius ?: 0
      val bottom = insets.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT)?.radius ?: 0
      return min(top, bottom).toFloat()
    }
    val default = dimen("rounded_corner_radius") - dimen("rounded_corner_radius_adjustment")
    val top = (dimen("rounded_corner_radius_top") - dimen("rounded_corner_radius_top_adjustment"))
      .takeIf { it != 0f } ?: default
    val bottom = (dimen("rounded_corner_radius_bottom") - dimen("rounded_corner_radius_bottom_adjustment"))
      .takeIf { it != 0f } ?: default
    return min(top, bottom)
  }

  private fun dp(value: Float) = value * activity.resources.displayMetrics.density

  companion object {
    /** BackEvent.EDGE_NONE: a back button or key; the app's androidx.activity predates it. */
    private const val EDGE_NONE = 2

    /** How long React may take to hear of a native dismissal. */
    private const val DISMISSAL_NOTICE_MS = 1000L

    @Volatile private var nativeDismissalAt = 0L

    /** Told when a committed back is about to dismiss the top screen natively. */
    @Volatile var onDismissing: (() -> Unit)? = null

    /**
     * Whether a screen was just dismissed natively by a committed back, once: the removal React
     * is about to run only follows it, so the screen keeps no frame for an exit transition.
     */
    fun takeNativeDismissal(): Boolean {
      val at = nativeDismissalAt
      nativeDismissalAt = 0L
      return at != 0L && SystemClock.uptimeMillis() - at < DISMISSAL_NOTICE_MS
    }

    /** cross_task_back_vertical_margin */
    private const val MARGIN_DP = 8f

    /** cross_activity_back_entering_start_offset */
    private const val ENTERING_OFFSET_DP = 96f

    /** DefaultCrossActivityBackAnimation.getPostCommitAnimationDuration */
    private const val POST_COMMIT_MS = 450L

    /** android.view.animation.BackGestureInterpolator */
    private val GESTURE = PathInterpolator(0.1f, 0.1f, 0f, 1f)

    private val VERTICAL = DecelerateInterpolator()

    /** Shell's Interpolators.EMPHASIZED */
    private val EMPHASIZED = PathInterpolator(
      Path().apply {
        moveTo(0f, 0f)
        cubicTo(0.05f, 0f, 0.133333f, 0.06f, 0.166666f, 0.4f)
        cubicTo(0.208333f, 0.82f, 0.25f, 1f, 1f, 1f)
      },
    )

    private val callbacks = WeakHashMap<ComponentActivity, StackBack>()

    /**
     * The activity's callback, registered once and after React Native's, so it sees Back first
     * while Compose back handlers registered later still come before it.
     */
    fun of(activity: ComponentActivity): StackBack =
      callbacks.getOrPut(activity) {
        StackBack(activity).also { activity.onBackPressedDispatcher.addCallback(activity, it) }
      }
  }
}

private fun RectF.scaleCentered(scale: Float) {
  val x = width() / 2f + left
  val y = height() / 2f + top
  offset(-x, -y)
  left *= scale
  top *= scale
  right *= scale
  bottom *= scale
  offset(x, y)
}

private fun RectF.lerp(from: RectF, to: RectF, fraction: Float) {
  left = from.left + (to.left - from.left) * fraction
  top = from.top + (to.top - from.top) * fraction
  right = from.right + (to.right - from.right) * fraction
  bottom = from.bottom + (to.bottom - from.bottom) * fraction
}
