package app.vaka.ui

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Rect
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import java.util.WeakHashMap

/**
 * Keeps a closing screen's last frame on screen while the stack fades it out. React Native
 * removes a popped screen's views before the transition starts; classic views keep drawing
 * through it, but Compose content redraws without its removed children, so the fade would show
 * an empty page. The screen's pixels are copied from the window and drawn in its overlay, which
 * stays until the screen itself is gone.
 */
internal object ScreenFreeze {
  private val frozen = WeakHashMap<View, Drawable>()

  /**
   * The root view of the stack fragment holding [view]: the stack fades it and keeps it until
   * the transition ends. Found through the fragment rather than by class, which R8 renames.
   */
  private fun screenOf(view: View): View =
    try {
      FragmentManager.findFragment<Fragment>(view).view ?: view
    } catch (_: IllegalStateException) {
      view
    }

  fun freeze(activity: Activity, view: View, done: (Boolean) -> Unit) {
    val screen = screenOf(view)
    val width = screen.width
    val height = screen.height
    if (!screen.isAttachedToWindow || width == 0 || height == 0) return done(false)
    val origin = IntArray(2).also { screen.getLocationInWindow(it) }
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val source = Rect(origin[0], origin[1], origin[0] + width, origin[1] + height)
    PixelCopy.request(activity.window, source, bitmap, { result ->
      if (result != PixelCopy.SUCCESS || !screen.isAttachedToWindow) {
        bitmap.recycle()
        return@request done(false)
      }
      thaw(screen)
      val drawable = BitmapDrawable(screen.resources, bitmap).apply { setBounds(0, 0, width, height) }
      screen.overlay.add(drawable)
      frozen[screen] = drawable
      done(true)
    }, Handler(Looper.getMainLooper()))
  }

  /** The frame a closing screen shows in place of its content, if it has one. */
  fun frameOf(screen: View): Drawable? = frozen[screen]

  /** Removes the frame again, for a screen that stayed (the removal was cancelled). */
  fun thaw(view: View) {
    val screen = screenOf(view)
    frozen.remove(screen)?.let { screen.overlay.remove(it) }
  }
}
