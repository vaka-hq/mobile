package expo.modules.androidcomponents

import android.os.Bundle
import android.view.Choreographer
import android.view.View
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager
import com.swmansion.rnscreens.Screen
import com.swmansion.rnscreens.ScreenStack
import com.swmansion.rnscreens.ScreenStackFragment
import java.util.WeakHashMap

/**
 * Starts a stack transition only once the screen it shows has drawn, as WindowManager starts an
 * activity transition once the new window has drawn. A new screen's first frame measures all of
 * its Compose content, which takes tens of milliseconds; the transition's clock would run through
 * it, and the opening curve (`fast_out_extra_slow_in`, 96% of the way in its first 100 ms) would
 * be over before anything moved. So every stack screen's transaction waits (Fragment's postponed
 * transitions) until the screen has laid out, drawn a frame and reached the next one.
 */
internal object StackEnter {
  /** The longest a transition waits for its screen. */
  private const val LIMIT_MS = 300L

  /** Set while predictive back attaches a screen itself, which needs it shown at once. */
  var bypass = false

  private val registered = WeakHashMap<FragmentActivity, Boolean>()

  fun register(activity: FragmentActivity) {
    if (registered.put(activity, true) == true) return
    activity.supportFragmentManager.registerFragmentLifecycleCallbacks(
      object : FragmentManager.FragmentLifecycleCallbacks() {
        override fun onFragmentViewCreated(
          fm: FragmentManager,
          fragment: Fragment,
          view: View,
          savedInstanceState: Bundle?,
        ) {
          if (fragment is ScreenStackFragment) postpone(fragment, view)
        }
      },
      true,
    )
  }

  private fun postpone(fragment: ScreenStackFragment, view: View) {
    val screen = fragment.screen
    val stack = screen.container as? ScreenStack ?: return
    // The stack's first screen has no transition, and sheets wait for their own layout already.
    if (bypass || stack.screenCount <= 1 || screen.stackPresentation != Screen.StackPresentation.PUSH) return
    fragment.postponeEnterTransition()
    // The screens beside it now are the ones the transition moves away from it.
    val others = (0 until stack.childCount).map { stack.getChildAt(it) }.filter { it !== view }
    var started = false
    val start = {
      if (!started) {
        started = true
        fragment.startPostponedEnterTransition()
        StackEdges.extend(stack, view, others, stack.goingForward)
      }
    }
    val choreographer = Choreographer.getInstance()
    // A frame to lay out and draw the screen, then the next one: the transition starts there.
    choreographer.postFrameCallback {
      choreographer.postFrameCallback {
        if (view.isLaidOut) start() else view.post { start() }
      }
    }
    view.postDelayed({ start() }, LIMIT_MS)
  }
}
