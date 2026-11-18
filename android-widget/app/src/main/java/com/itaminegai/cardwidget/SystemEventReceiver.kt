package com.itaminegai.cardwidget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 再起動・アプリ更新・時刻やタイムゾーンの変更時に、表示とアラームを整え直す。 */
class SystemEventReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!CardWidgetProvider.hasWidgets(context)) return
        CardWidgetProvider.updateAll(context)
        RolloverScheduler.schedule(context)
    }
}
