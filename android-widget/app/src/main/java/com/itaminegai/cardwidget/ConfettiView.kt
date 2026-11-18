package com.itaminegai.cardwidget

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.random.Random

/** 2枚そろったときに降らせる紙吹雪。タッチは下の画面に素通しする。 */
class ConfettiView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null,
) : View(context, attrs) {

    private class Piece(
        var x: Float, var y: Float, val vx: Float, val vy: Float,
        var angle: Float, val spin: Float, val w: Float, val h: Float, val color: Int,
    )

    private val colors = intArrayOf(
        0xFF12838B.toInt(), 0xFF5CB8BE.toInt(), 0xFFE8B84A.toInt(),
        0xFFF2A7A0.toInt(), 0xFFFFFFFF.toInt(), 0xFF9AD3C2.toInt(),
    )
    private val pieces = mutableListOf<Piece>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var progress = 0f
    private var animator: ValueAnimator? = null

    init {
        isClickable = false
        isFocusable = false
    }

    fun burst() {
        animator?.cancel()
        pieces.clear()
        val d = resources.displayMetrics.density
        repeat(110) {
            pieces += Piece(
                x = Random.nextFloat() * width,
                y = -Random.nextFloat() * height * 0.5f - 20 * d,
                vx = (Random.nextFloat() - 0.5f) * 120 * d,
                vy = (260 + Random.nextFloat() * 340) * d,
                angle = Random.nextFloat() * 360,
                spin = (Random.nextFloat() - 0.5f) * 720,
                w = (5 + Random.nextFloat() * 6) * d,
                h = (8 + Random.nextFloat() * 8) * d,
                color = colors[Random.nextInt(colors.size)],
            )
        }
        var last = 0L
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 2600
            interpolator = LinearInterpolator()
            addUpdateListener { a ->
                val now = a.currentPlayTime
                val dt = (now - last) / 1000f
                last = now
                progress = a.animatedFraction
                for (p in pieces) {
                    p.x += p.vx * dt
                    p.y += p.vy * dt
                    p.angle += p.spin * dt
                }
                invalidate()
            }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        if (animator?.isRunning != true) return
        // 最後の3割でふわっと消える
        val alpha = if (progress < 0.7f) 255 else ((1 - progress) / 0.3f * 255).toInt()
        for (p in pieces) {
            paint.color = p.color
            paint.alpha = alpha
            canvas.save()
            canvas.rotate(p.angle, p.x, p.y)
            canvas.drawRect(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, paint)
            canvas.restore()
        }
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        super.onDetachedFromWindow()
    }
}
