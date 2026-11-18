package com.itaminegai.cardwidget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Android 15 以降の全画面表示でステータスバーと重ならないように余白をとる
        val scroll = findViewById<View>(R.id.scroll)
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            @Suppress("DEPRECATION")
            v.setPadding(0, insets.systemWindowInsetTop, 0, insets.systemWindowInsetBottom)
            insets
        }

        val add = findViewById<Button>(R.id.add_widget)
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

        val next = CardDeck.nextRollover()
            .format(DateTimeFormatter.ofPattern("M月d日(E) H:mm", Locale.JAPANESE))
        findViewById<TextView>(R.id.next_change).text = getString(R.string.next_change, next)
        findViewById<TextView>(R.id.progress).text = getString(
            R.string.progress,
            today.pain.cycle, today.pain.dayInCycle,
            today.wish.cycle, today.wish.dayInCycle,
        )

        // ウィジェット側も同じ状態にそろえておく
        CardWidgetProvider.updateAll(this)
        if (CardWidgetProvider.hasWidgets(this)) RolloverScheduler.schedule(this)
    }
}
