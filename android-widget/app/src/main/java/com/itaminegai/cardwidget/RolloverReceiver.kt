package com.itaminegai.cardwidget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 20:00 のアラームを受けてカードを切り替え、次の日のアラームを設定する。 */
class RolloverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        CardWidgetProvider.updateAll(context)
        if (CardWidgetProvider.hasWidgets(context)) RolloverScheduler.schedule(context)
    }
}
