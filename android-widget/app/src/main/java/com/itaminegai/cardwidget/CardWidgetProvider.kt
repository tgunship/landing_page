package com.itaminegai.cardwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class CardWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        render(context, manager, appWidgetIds)
        RolloverScheduler.schedule(context)
    }

    override fun onEnabled(context: Context) {
        RolloverScheduler.schedule(context)
    }

    override fun onDisabled(context: Context) {
        RolloverScheduler.cancel(context)
    }

    companion object {
        /** 配置済みのすべてのウィジェットを今日のカードで更新する。 */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, CardWidgetProvider::class.java))
            if (ids.isNotEmpty()) render(context, manager, ids)
        }

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context)
                .getAppWidgetIds(ComponentName(context, CardWidgetProvider::class.java))
                .isNotEmpty()

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val today = CardDeck.today(context)
            val cards = CardResources(context)
            val open = PendingIntent.getActivity(
                context, 0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.widget_cards).apply {
                    setImageViewResource(R.id.pain_card, cards.image(CardDeck.Kind.PAIN, today.pain.cardIndex))
                    setImageViewResource(R.id.wish_card, cards.image(CardDeck.Kind.WISH, today.wish.cardIndex))
                    setContentDescription(R.id.pain_card, "痛みカード：" + cards.text(CardDeck.Kind.PAIN, today.pain.cardIndex))
                    setContentDescription(R.id.wish_card, "願いカード：" + cards.text(CardDeck.Kind.WISH, today.wish.cardIndex))
                    setOnClickPendingIntent(R.id.widget_root, open)
                }
                manager.updateAppWidget(id, views)
            }
        }
    }
}
