package app.vaka.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.view.View
import android.view.ViewTreeObserver
import android.view.animation.Transformation
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Holds its content still while the stack slides the screen it is on sideways, such as the tab
 * bar under the tabs: a screen opening over them covers it and one closing reveals it, while the
 * tabs themselves slide. The stack's transitions are view animations on the screen
 * (`config/android-transitions`), which move what the screen draws; each frame of one, the
 * content is drawn back by as far as the screen has moved. A back swipe's preview scales and moves
 * the screen as a card instead (`StackBack.kt`), and the content goes with it.
 */
@SuppressLint("ViewConstructor")
class StillView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val transformation = Transformation()
  private val values = FloatArray(9)
  private var drawnShift = 0f

  // The screen's animation does not redraw what is on it; each frame it runs, this draws again.
  private val frame = ViewTreeObserver.OnPreDrawListener {
    if (shift() != drawnShift) invalidate()
    true
  }

  init {
    clipChildren = false
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(frame)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnPreDrawListener(frame)
    super.onDetachedFromWindow()
  }

  override fun dispatchDraw(canvas: Canvas) {
    val shift = shift()
    drawnShift = shift
    if (shift == 0f) {
      super.dispatchDraw(canvas)
      return
    }
    canvas.save()
    canvas.translate(-shift, 0f)
    super.dispatchDraw(canvas)
    canvas.restore()
  }

  /** How far sideways the view animation running on a screen this view is in has moved it. */
  private fun shift(): Float {
    var view = parent as? View
    while (view != null) {
      val animation = view.animation
      if (animation != null && animation.hasStarted() && !animation.hasEnded()) {
        transformation.clear()
        animation.getTransformation(view.drawingTime, transformation)
        transformation.matrix.getValues(values)
        return values[Matrix.MTRANS_X]
      }
      view = view.parent as? View
    }
    return 0f
  }
}
