package com.itaminegai.cardwidget

import android.app.Activity
import android.app.AlertDialog
import android.app.TimePickerDialog
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        applySystemBarPadding(findViewById(R.id.scroll))

        findViewById<View>(R.id.time_row).setOnClickListener { pickRolloverTime() }
        findViewById<View>(R.id.reset).setOnClickListener { confirmReset() }
        findViewById<View>(R.id.advance).setOnClickListener {
            CardDeck.advanceNow(this)
            CardWidgetProvider.updateAll(this)
            refresh()
        }
        findViewById<View>(R.id.open_slot).setOnClickListener {
            startActivity(Intent(this, SlotActivity::class.java))
        }
        findViewById<View>(R.id.show_list).setOnClickListener {
            startActivity(Intent(this, CardListActivity::class.java))
        }

        val add = findViewById<View>(R.id.add_widget)
        val manager = AppWidgetManager.getInstance(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported) {
            add.setOnClickListener {
                manager.requestPinAppWidget(ComponentName(this, CardWidgetProvider::class.java), null, null)
            }
        } else {
            add.visibility = View.GONE
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
        // ウィジェット側も同じ状態にそろえておく
        CardWidgetProvider.updateAll(this)
        if (CardWidgetProvider.hasWidgets(this)) RolloverScheduler.schedule(this)
    }

    private fun refresh() {
        val today = CardDeck.today(this)
        val cards = CardResources(this)

        findViewById<ImageView>(R.id.pain_card).apply {
            setImageResource(cards.image(CardDeck.Kind.PAIN, today.pain.cardIndex))
            contentDescription = cards.text(CardDeck.Kind.PAIN, today.pain.cardIndex)
        }
        findViewById<ImageView>(R.id.wish_card).apply {
            setImageResource(cards.image(CardDeck.Kind.WISH, today.wish.cardIndex))
            contentDescription = cards.text(CardDeck.Kind.WISH, today.wish.cardIndex)
        }

        findViewById<TextView>(R.id.date).text =
            java.time.LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy年M月d日(E)", Locale.JAPANESE))

        val time = CardDeck.rolloverTime(this).format(TIME_FORMAT)
        findViewById<TextView>(R.id.rollover_time).text = time
        findViewById<TextView>(R.id.how_to).text = getString(R.string.how_to, time)

        val next = CardDeck.nextRollover(this)
            .format(DateTimeFormatter.ofPattern("M/d(E) H:mm", Locale.JAPANESE))
        findViewById<TextView>(R.id.next_change).text = getString(R.string.next_change, next)
        findViewById<TextView>(R.id.progress).text = getString(
            R.string.progress,
            today.pain.cycle, today.pain.dayInCycle,
            today.wish.cycle, today.wish.dayInCycle,
        )
    }

    private fun pickRolloverTime() {
        val current = CardDeck.rolloverTime(this)
        TimePickerDialog(this, { _, hour, minute ->
            CardDeck.setRolloverTime(this, LocalTime.of(hour, minute))
            RolloverScheduler.schedule(this)
            CardWidgetProvider.updateAll(this)
            refresh()
        }, current.hour, current.minute, true).show()
    }

    private fun confirmReset() {
        AlertDialog.Builder(this)
            .setTitle(R.string.reset_confirm_title)
            .setMessage(R.string.reset_confirm_message)
            .setPositiveButton(R.string.reset_confirm_ok) { _, _ ->
                CardDeck.reset(this)
                CardWidgetProvider.updateAll(this)
                if (CardWidgetProvider.hasWidgets(this)) RolloverScheduler.schedule(this)
                refresh()
            }
            .setNegativeButton(R.string.reset_confirm_cancel, null)
            .show()
    }

    companion object {
        private val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("H:mm")
    }
}

/** Android 15 以降の全画面表示でステータスバー・ナビゲーションバーと重ならないように余白をとる。 */
fun applySystemBarPadding(view: View) {
    val left = view.paddingLeft
    val top = view.paddingTop
    val right = view.paddingRight
    val bottom = view.paddingBottom
    view.setOnApplyWindowInsetsListener { v, insets ->
        @Suppress("DEPRECATION")
        v.setPadding(left, top + insets.systemWindowInsetTop, right, bottom + insets.systemWindowInsetBottom)
        insets
    }
}
