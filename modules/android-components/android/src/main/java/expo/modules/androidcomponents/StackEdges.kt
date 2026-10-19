package expo.modules.androidcomponents

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.view.Choreographer
import android.view.View
import android.view.ViewGroup
import android.view.animation.AnimationUtils
import com.swmansion.rnscreens.ScreenStack

/**
 * The `extend` of Android's activity transitions for stack screens. WindowManager stretches a
 * moving window's edge pixels 96 dp into the gap the slide opens, so the screen underneath never
 * shows at the edge; view animations ignore `extend`. Here each moving screen draws its own edge
 * column stretched over the same side as the transition resources (`config/android-transitions`):
 * a screen moving right (the one opening, the one closing) on its left, a screen moving left (the
 * one covered, the one revealed) on its right. The strip is part of the screen's drawing, so it
 * moves and fades with it, and it goes when the screen's animation ends.
 */
internal object StackEdges {
  private const val EXTEND_DP = 96f

  /** Strips give up after this long, should an animation never report its end. */
  private const val LIMIT_MS = 1000L

  /**
   * Extends the screens of the transition that starts now in [stack]: [entering], which a push
   * opens (`forward`) or a pop reveals, and [others], the screens beside it while the
   * transaction waited (the one covered or closing), which leave the stack's children once their
   * removal runs.
   */
  fun extend(stack: ScreenStack, entering: View, others: List<View>, forward: Boolean) {
    if (!stack.isHardwareAccelerated) return
    val extend = EXTEND_DP * stack.resources.displayMetrics.density
    val edges = (listOf(entering) + others).mapNotNull { view ->
      val owner = view as? ViewGroup ?: return@mapNotNull null
      // Opening moves the new screen right, closing moves the closing one right.
      val left = if (forward) owner === entering else owner !== entering
      Edge(owner, left, extend, owner.background).also { owner.background = it }
    }
    if (edges.isEmpty()) return
    stack.clipChildren = false
    watch(stack, edges, AnimationUtils.currentAnimationTimeMillis())
  }

  /** Each frame until the screens stop moving, then takes their strips away again. */
  private fun watch(stack: ScreenStack, edges: List<Edge>, since: Long) {
    Choreographer.getInstance().postFrameCallback {
      val late = AnimationUtils.currentAnimationTimeMillis() - since > LIMIT_MS
      var extending = false
      for (edge in edges) {
        if (edge.done) continue
        val animation = edge.owner.animation
        if (animation != null && !animation.hasEnded()) edge.seen = true
        if (late || (edge.seen && (animation == null || animation.hasEnded()))) edge.remove()
        else extending = true
      }
      if (extending) watch(stack, edges, since) else stack.clipChildren = true
    }
  }

  private class Edge(
    val owner: ViewGroup,
    private val left: Boolean,
    private val extend: Float,
    val saved: Drawable?,
  ) : Drawable() {
    var seen = false
    var done = false

    fun remove() {
      done = true
      if (owner.background === this) owner.background = saved
    }

    /**
     * The view sizes its background to itself, and the background's render node clips to those
     * bounds; they reach out by the gap on both sides, so the strip can draw there.
     */
    override fun setBounds(left: Int, top: Int, right: Int, bottom: Int) {
      saved?.setBounds(left, top, right, bottom)
      val reach = extend.toInt() + 1
      super.setBounds(left - reach, top, right + reach, bottom)
    }

    override fun draw(canvas: Canvas) {
      saved?.draw(canvas)
      val content = owner.getChildAt(0) ?: return
      if (!canvas.isHardwareAccelerated) return
      val width = owner.width.toFloat()
      val height = owner.height.toFloat()
      canvas.save()
      // A one-pixel column at the edge, stretched across the gap beside it.
      if (left) {
        canvas.clipRect(-extend, 0f, 0f, height)
        canvas.translate(-extend, 0f)
        canvas.scale(extend, 1f)
        canvas.clipRect(0f, 0f, 1f, height)
      } else {
        canvas.clipRect(width, 0f, width + extend, height)
        canvas.translate(width, 0f)
        canvas.scale(extend, 1f)
        canvas.translate(-(width - 1f), 0f)
        canvas.clipRect(width - 1f, 0f, width, height)
      }
      // A closing screen shows its kept frame instead of its (already removed) content.
      val frame = ScreenFreeze.frameOf(owner)
      if (frame != null) {
        frame.draw(canvas)
      } else {
        canvas.translate(content.left.toFloat(), content.top.toFloat())
        content.draw(canvas)
      }
      canvas.restore()
    }

    override fun setAlpha(alpha: Int) {}

    override fun setColorFilter(colorFilter: ColorFilter?) {}

    @Deprecated("Deprecated in Drawable")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
  }
}
