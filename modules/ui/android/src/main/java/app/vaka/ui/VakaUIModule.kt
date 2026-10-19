package app.vaka.ui

import android.net.Uri
import android.os.Build
import android.view.RoundedCorner
import android.view.View
import com.facebook.react.ReactActivity
import com.facebook.react.uimanager.UIManagerHelper
import io.github.expo.modules.v2.ExpoModule
import io.github.expo.modules.v2.JS
import io.github.expo.modules.v2.Module
import io.github.expo.modules.v2.Record
import io.github.expo.modules.v2.react.currentActivity
import io.github.expo.modules.v2.react.reactContextOrNull
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/** Nothing to say but that it happened, for events that carry no data. */
@Record
class Signal

/**
 * What the screens need of Android beyond their views: Back and its predictive preview, a closing
 * screen's last frame, the screen's corners, and an EPUB's contents read before the reader opens.
 */
@ExpoModule("VakaUI")
class VakaUIModule : Module() {
  /** A committed back swipe is about to dismiss the top screen natively. */
  @io.github.expo.modules.v2.Event(name = "onNativeDismissal")
  private val onNativeDismissal = event<Signal>()

  init {
    StackBack.onDismissing = { onNativeDismissal(Signal()) }
  }

  override fun onDestroy() {
    StackBack.onDismissing = null
  }

  /** The radius of the screen's bottom corners in dp, or 0 where Android does not report it. */
  @JS
  fun bottomCornerRadius(): Double {
    val activity = currentActivity
    if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return 0.0
    }

    val corner = activity.display?.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT) ?: return 0.0

    return corner.radius / activity.resources.displayMetrics.density.toDouble()
  }

  /**
   * Whether React Native handles Back; off at the root screen, so Android can animate back to the
   * home screen. False while no activity is attached yet, for the caller to try again.
   */
  @JS
  fun setReactNativeBack(enabled: Boolean): Boolean {
    val activity = currentActivity as? ReactActivity ?: return false
    setReactNativeBack(activity, enabled)
    // Stack screens get predictive back wherever React Native would handle Back.
    activity.runOnUiThread {
      StackEnter.register(activity)
      StackBack.of(activity).setWanted(enabled)
    }
    return true
  }

  /** While the app takes Back for itself, a back swipe previews nothing. */
  @JS
  fun setBackPreviewBlocked(blocked: Boolean): Boolean {
    val activity = currentActivity as? ReactActivity ?: return false
    activity.runOnUiThread { StackBack.of(activity).setBlocked(blocked) }
    return true
  }

  /** A closing screen keeps its last frame through the stack's exit transition. */
  @JS
  suspend fun freezeScreen(tag: Int): Boolean = withContext(Dispatchers.Main) {
    val activity = currentActivity
    val view = viewOf(tag)
    if (activity == null || view == null) {
      false
    } else {
      suspendCancellableCoroutine { continuation ->
        ScreenFreeze.freeze(activity, view) { kept -> continuation.resume(kept) }
      }
    }
  }

  /** Takes the kept frame away from a screen that stayed. */
  @JS
  suspend fun thawScreen(tag: Int): Unit = withContext(Dispatchers.Main) {
    viewOf(tag)?.let { ScreenFreeze.thaw(it) }
  }

  /** A predictive back removes its screen natively first; such a screen has nothing to freeze. */
  @JS
  fun takeNativeDismissal(): Boolean = StackBack.takeNativeDismissal()

  /**
   * An EPUB's contents with where each part starts, from 0 to 1, as JSON: the same parts and
   * places the reader reports on opening it, read without opening it, such as once it is
   * downloaded, so a place heard in its audiobook can be found in it before the reader opens.
   */
  @JS
  suspend fun readBookSections(uri: String): String = withContext(Dispatchers.IO) {
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

  /** The view React Native draws for `tag`, on the main thread. */
  private fun viewOf(tag: Int): View? {
    val reactContext = reactContextOrNull ?: return null

    return UIManagerHelper.getUIManagerForReactTag(reactContext, tag)?.resolveView(tag)
  }
}
