package com.itaminegai.cardwidget

import android.Manifest
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PorterDuff
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlin.math.pow
import kotlin.random.Random

/**
 * カード占い（あそび）。ウィジェットの山札とは関係なく、毎回ランダム。
 *
 * 1. 最初は2枚とも裏向き
 * 2. スタート → 痛みカードがめくれて、ピコピコと高速で入れ替わる
 * 3. ストップ → ピタッとは止まらず、だんだんゆっくりになって止まる（ときどき「じらし」あり）
 * 4. 続けて願いカードがめくれて回りはじめ、ストップで同じように止まる
 * 5. 2枚そろうとファンファーレと紙吹雪。お題と、結果画像の保存・共有
 */
class SlotActivity : Activity() {

    private enum class State { READY, PAIN_SPIN, PAIN_STOPPING, WISH_SPIN, WISH_STOPPING, DONE }

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var cards: CardResources
    private lateinit var painView: ImageView
    private lateinit var wishView: ImageView
    private lateinit var painLabel: TextView
    private lateinit var wishLabel: TextView
    private lateinit var message: TextView
    private lateinit var button: TextView
    private lateinit var soundToggle: TextView
    private lateinit var resultSection: View
    private lateinit var promptView: TextView
    private lateinit var promptBox: View
    private lateinit var promptOpen: View
    private lateinit var confetti: ConfettiView
    private lateinit var prompts: Array<String>

    private var state = State.READY
    private var painIndex = -1
    private var wishIndex = -1
    private var promptIndex = -1
    private var sound: SoundFx? = null
    private var soundOn = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_slot)
        applySystemBarPadding(findViewById(R.id.root))

        cards = CardResources(this)
        painView = findViewById(R.id.pain_card)
        wishView = findViewById(R.id.wish_card)
        painLabel = findViewById(R.id.pain_label)
        wishLabel = findViewById(R.id.wish_label)
        message = findViewById(R.id.message)
        button = findViewById(R.id.slot_button)
        soundToggle = findViewById(R.id.sound_toggle)
        resultSection = findViewById(R.id.result_section)
        promptView = findViewById(R.id.prompt)
        promptBox = findViewById(R.id.prompt_box)
        promptOpen = findViewById(R.id.prompt_open)
        promptOpen.setOnClickListener { openPrompt() }
        confetti = findViewById(R.id.confetti)
        prompts = resources.getStringArray(R.array.prompts)

        findViewById<View>(R.id.prompt_other).setOnClickListener { nextPrompt() }
        findViewById<View>(R.id.save).setOnClickListener { saveResult() }
        findViewById<View>(R.id.share).setOnClickListener { shareResult() }

        val density = resources.displayMetrics.density
        painView.cameraDistance = 8000 * density
        wishView.cameraDistance = 8000 * density

        soundOn = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SOUND, true)
        updateSoundToggle()
        soundToggle.setOnClickListener {
            soundOn = !soundOn
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_SOUND, soundOn).apply()
            updateSoundToggle()
            sound?.enabled = soundOn
        }

        button.setOnClickListener { onButton() }
        showReady()
    }

    override fun onStart() {
        super.onStart()
        sound = SoundFx().also { it.enabled = soundOn }
        // 回転中に画面を離れていた場合は再開
        when (state) {
            State.PAIN_SPIN -> spin(CardDeck.Kind.PAIN)
            State.WISH_SPIN -> spin(CardDeck.Kind.WISH)
            else -> Unit
        }
    }

    override fun onStop() {
        super.onStop()
        handler.removeCallbacksAndMessages(null)
        // 止まりかけの途中で離れたら、その場で止めてしまう
        when (state) {
            State.PAIN_STOPPING -> lock(CardDeck.Kind.PAIN, animate = false)
            State.WISH_STOPPING -> lock(CardDeck.Kind.WISH, animate = false)
            else -> Unit
        }
        sound?.release()
        sound = null
    }

    private fun onButton() {
        when (state) {
            State.READY -> {
                state = State.PAIN_SPIN
                message.setText(R.string.slot_pain_spinning)
                setButton(R.string.slot_stop, enabled = true)
                painIndex = Random.nextInt(CardDeck.CARD_COUNT)
                flip(painView, cards.image(CardDeck.Kind.PAIN, painIndex)) { spin(CardDeck.Kind.PAIN) }
            }
            State.PAIN_SPIN -> {
                state = State.PAIN_STOPPING
                message.setText(R.string.slot_pain_stopping)
                setButton(R.string.slot_stopping, enabled = false)
                handler.removeCallbacksAndMessages(null)
                slowDown(CardDeck.Kind.PAIN)
            }
            State.WISH_SPIN -> {
                state = State.WISH_STOPPING
                setButton(R.string.slot_stopping, enabled = false)
                handler.removeCallbacksAndMessages(null)
                slowDown(CardDeck.Kind.WISH)
            }
            State.DONE -> {
                // 2枚とも裏向きに戻して最初から
                setButton(R.string.slot_start, enabled = false)
                resultSection.animate().alpha(0f).setDuration(200).withEndAction {
                    resultSection.visibility = View.GONE
                }.start()
                flip(painView, R.drawable.back_pain) {}
                handler.postDelayed({
                    flip(wishView, R.drawable.back_wish) { showReady() }
                }, 150)
            }
            else -> Unit
        }
    }

    private fun showReady() {
        state = State.READY
        painIndex = -1
        wishIndex = -1
        painView.setImageResource(R.drawable.back_pain)
        wishView.setImageResource(R.drawable.back_wish)
        painLabel.setTextColor(getColor(R.color.sub))
        wishLabel.setTextColor(getColor(R.color.sub))
        message.setText(R.string.slot_intro)
        message.textSize = 16f
        message.setTypeface(null, android.graphics.Typeface.NORMAL)
        message.setTextColor(getColor(R.color.ink))
        setButton(R.string.slot_start, enabled = true)
    }

    /** ピコピコと高速で入れ替える。 */
    private fun spin(kind: CardDeck.Kind) {
        val tick = object : Runnable {
            override fun run() {
                step(kind, haptic = false)
                handler.postDelayed(this, SPIN_INTERVAL_MS)
            }
        }
        handler.post(tick)
    }

    /**
     * ストップ後、だんだんゆっくりになって止まる。
     * ときどき「止まった…？」と思わせてから、もう1枚だけ進む（じらし）。
     */
    private fun slowDown(kind: CardDeck.Kind) {
        val steps = Random.nextInt(7, 12)
        val teaseAtEnd = Random.nextFloat() < 0.35f
        var k = 0
        val next = object : Runnable {
            override fun run() {
                k++
                step(kind, haptic = true)
                when {
                    k < steps -> {
                        val t = k.toFloat() / steps
                        handler.postDelayed(this, (SPIN_INTERVAL_MS + 560 * t.pow(2.2f)).toLong())
                    }
                    teaseAtEnd && k == steps -> handler.postDelayed(this, 1000)
                    else -> handler.postDelayed({ lock(kind, animate = true) }, 250)
                }
            }
        }
        handler.postDelayed(next, SPIN_INTERVAL_MS)
    }

    /** 次のカードを表示（同じカードが続かないように）。 */
    private fun step(kind: CardDeck.Kind, haptic: Boolean) {
        val view = if (kind == CardDeck.Kind.PAIN) painView else wishView
        val current = if (kind == CardDeck.Kind.PAIN) painIndex else wishIndex
        var next = Random.nextInt(CardDeck.CARD_COUNT - 1)
        if (next >= current && current >= 0) next++
        if (kind == CardDeck.Kind.PAIN) painIndex = next else wishIndex = next

        view.setImageResource(cards.image(kind, next))
        // スロットのリールのように、上から少し落ちてくる動き
        view.translationY = -view.height * 0.06f
        view.animate().translationY(0f).setDuration(60).setInterpolator(DecelerateInterpolator()).start()

        sound?.tick()
        if (haptic) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    }

    /** カードが1枚に定まったときの演出と、次の段階への移行。 */
    private fun lock(kind: CardDeck.Kind, animate: Boolean) {
        val view = if (kind == CardDeck.Kind.PAIN) painView else wishView
        val label = if (kind == CardDeck.Kind.PAIN) painLabel else wishLabel
        label.setTextColor(getColor(R.color.teal))
        if (animate) {
            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            sound?.lock()
            view.scaleX = 1f
            view.scaleY = 1f
            view.animate().scaleX(1.08f).scaleY(1.08f).setDuration(120).withEndAction {
                view.animate().scaleX(1f).scaleY(1f).setDuration(380)
                    .setInterpolator(OvershootInterpolator(3f)).start()
            }.start()
        }

        if (kind == CardDeck.Kind.PAIN) {
            state = State.WISH_SPIN
            val painText = cards.text(CardDeck.Kind.PAIN, painIndex)
            message.text = getString(R.string.slot_wish_spinning, painText)
            setButton(R.string.slot_stop, enabled = false)
            wishIndex = Random.nextInt(CardDeck.CARD_COUNT)
            if (animate) {
                // ひと呼吸おいてから願いカードがめくれて回りはじめる
                handler.postDelayed({
                    flip(wishView, cards.image(CardDeck.Kind.WISH, wishIndex)) {
                        setButton(R.string.slot_stop, enabled = true)
                        spin(CardDeck.Kind.WISH)
                    }
                }, 900)
            } else {
                // 画面を離れたときは表だけ出しておき、戻ったら onStart で回しはじめる
                wishView.setImageResource(cards.image(CardDeck.Kind.WISH, wishIndex))
                setButton(R.string.slot_stop, enabled = true)
            }
        } else {
            state = State.DONE
            setButton(R.string.slot_again, enabled = false)
            if (animate) {
                handler.postDelayed({ celebrate() }, 420)
            } else {
                showResult()
            }
        }
    }

    /** 2枚そろったときの演出：ファンファーレ、2枚そろって弾む＋光る、紙吹雪。 */
    private fun celebrate() {
        sound?.finale()
        painView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        for ((i, v) in listOf(painView, wishView).withIndex()) {
            v.animate().cancel()
            v.scaleX = 1f
            v.scaleY = 1f
            v.animate().scaleX(1.12f).scaleY(1.12f).setStartDelay(i * 60L).setDuration(160).withEndAction {
                v.animate().scaleX(1f).scaleY(1f).setStartDelay(0).setDuration(520)
                    .setInterpolator(OvershootInterpolator(4f)).start()
            }.start()
            shine(v)
        }
        painLabel.setTextColor(getColor(R.color.teal))
        wishLabel.setTextColor(getColor(R.color.teal))
        confetti.burst()
        handler.postDelayed({ showResult() }, 700)
    }

    /** カードの形のまま白く2回きらっと光らせる。 */
    private fun shine(view: ImageView) {
        ValueAnimator.ofFloat(0f, 0.75f, 0f, 0.45f, 0f).apply {
            duration = 900
            addUpdateListener {
                val a = ((it.animatedValue as Float) * 255).toInt()
                view.setColorFilter(Color.argb(a, 255, 255, 255), PorterDuff.Mode.SRC_ATOP)
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) = view.clearColorFilter()
            })
            start()
        }
    }

    private fun showResult() {
        // 本来の問い。結果のときだけ大きく強調する
        message.setText(R.string.slot_result)
        message.textSize = 18f
        message.setTypeface(null, android.graphics.Typeface.BOLD)
        message.setTextColor(getColor(R.color.teal_dark))
        message.alpha = 0f
        message.animate().alpha(1f).setDuration(400).start()
        // おまけのお題は閉じた状態から
        promptIndex = -1
        promptBox.visibility = View.GONE
        promptOpen.visibility = View.VISIBLE
        resultSection.visibility = View.VISIBLE
        resultSection.alpha = 0f
        resultSection.translationY = 40f
        resultSection.animate().alpha(1f).translationY(0f).setDuration(450).start()
        setButton(R.string.slot_again, enabled = true)
        // 結果とお題が見えるようにスクロール
        handler.postDelayed({
            findViewById<ScrollView>(R.id.scroll).smoothScrollTo(0, message.top)
        }, 500)
    }

    private fun openPrompt() {
        promptOpen.visibility = View.GONE
        nextPrompt()
        promptBox.visibility = View.VISIBLE
        promptBox.alpha = 0f
        promptBox.animate().alpha(1f).setDuration(300).start()
        handler.postDelayed({
            findViewById<ScrollView>(R.id.scroll).smoothScrollTo(0, resultSection.bottom)
        }, 320)
    }

    private fun nextPrompt() {
        if (prompts.isEmpty()) return
        var next = Random.nextInt(prompts.size)
        if (prompts.size > 1 && next == promptIndex) next = (next + 1) % prompts.size
        promptIndex = next
        promptView.text = prompts[next]
        promptView.alpha = 0f
        promptView.animate().alpha(1f).setDuration(250).start()
    }

    private fun resultBitmap() = ResultImage.render(
        this, painIndex, wishIndex,
        message.text.toString(),
        // おまけのお題は開いたときだけ画像に入れる
        if (promptBox.visibility == View.VISIBLE) promptView.text.toString() else null,
    )

    private fun saveResult() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQUEST_SAVE)
            return
        }
        val uri = ResultImage.save(this, resultBitmap())
        Toast.makeText(this, if (uri != null) R.string.saved else R.string.save_failed, Toast.LENGTH_LONG).show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_SAVE && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) saveResult()
    }

    private fun shareResult() {
        try {
            ResultImage.share(this, resultBitmap())
        } catch (e: Exception) {
            Toast.makeText(this, R.string.save_failed, Toast.LENGTH_LONG).show()
        }
    }

    /** カードを裏返す（横に回転して絵柄を差し替える）。 */
    private fun flip(view: ImageView, resId: Int, then: () -> Unit) {
        view.animate().rotationY(90f).setDuration(160).withEndAction {
            view.setImageResource(resId)
            view.rotationY = -90f
            view.animate().rotationY(0f).setDuration(160).withEndAction(then).start()
        }.start()
    }

    private fun setButton(textRes: Int, enabled: Boolean) {
        button.setText(textRes)
        button.isEnabled = enabled
    }

    private fun updateSoundToggle() {
        soundToggle.setText(if (soundOn) R.string.sound_on else R.string.sound_off)
        soundToggle.isSelected = soundOn
    }

    companion object {
        private const val SPIN_INTERVAL_MS = 75L
        private const val PREFS = "slot"
        private const val KEY_SOUND = "sound"
        private const val REQUEST_SAVE = 10
    }
}
