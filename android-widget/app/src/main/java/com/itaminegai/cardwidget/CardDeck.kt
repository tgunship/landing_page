package com.itaminegai.cardwidget

import android.content.Context
import android.content.SharedPreferences
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import kotlin.random.Random

/**
 * 痛みカード・願いカードそれぞれの山札を管理する。
 *
 * - 54枚をランダムに並べ、1日1枚ずつ順に表示する（54日間は重複なし）
 * - 54枚すべて表示し終えたら、新しくシャッフルして次の1周へ
 * - 1日の区切りは毎日決まった時刻（初期値 20:00。アプリで変更可能）
 */
object CardDeck {
    const val CARD_COUNT = 54
    val DEFAULT_ROLLOVER_TIME: LocalTime = LocalTime.of(20, 0)

    private const val PREFS = "card_deck"
    private const val KEY_PERIOD = "period_epoch_day"
    private const val KEY_HOUR = "rollover_hour"
    private const val KEY_MINUTE = "rollover_minute"

    enum class Kind(val key: String) { PAIN("pain"), WISH("wish") }

    data class Position(val cardIndex: Int, val dayInCycle: Int, val cycle: Int)

    data class Today(val pain: Position, val wish: Position)

    /** 設定されている切り替え時刻。 */
    fun rolloverTime(context: Context): LocalTime {
        val prefs = prefs(context)
        return LocalTime.of(
            prefs.getInt(KEY_HOUR, DEFAULT_ROLLOVER_TIME.hour),
            prefs.getInt(KEY_MINUTE, DEFAULT_ROLLOVER_TIME.minute),
        )
    }

    /**
     * 切り替え時刻を変更する。今表示しているカードはそのままで、
     * 新しい時刻が次に来たときに次のカードへ進む。
     */
    @Synchronized
    fun setRolloverTime(context: Context, time: LocalTime) {
        today(context) // 変更前の時刻で、進めるべき分を先に反映しておく
        val period = currentPeriod(time).toEpochDay()
        prefs(context).edit()
            .putInt(KEY_HOUR, time.hour)
            .putInt(KEY_MINUTE, time.minute)
            .putLong(KEY_PERIOD, period)
            .commit()
    }

    /**
     * 表示した回数をリセットする。両方の山札を新しくシャッフルし、1周目の1日目から始め直す。
     * 切り替え時刻の設定はそのまま。
     */
    @Synchronized
    fun reset(context: Context) {
        val prefs = prefs(context)
        val editor = prefs.edit()
        Kind.values().forEach { startCycle(editor, it, cycle = 1, previousLast = -1) }
        editor.putLong(KEY_PERIOD, currentPeriod(rolloverTime(context)).toEpochDay())
        editor.commit()
    }

    /** 今の時刻が属する「日」（直近の切り替え時刻が属する日付）。 */
    fun currentPeriod(time: LocalTime, now: ZonedDateTime = ZonedDateTime.now()): LocalDate {
        val today = now.toLocalDate()
        return if (now.toLocalTime() >= time) today else today.minusDays(1)
    }

    /** 次にカードが切り替わる時刻。 */
    fun nextRollover(context: Context, now: ZonedDateTime = ZonedDateTime.now()): ZonedDateTime {
        val todayAt = now.with(rolloverTime(context)).withSecond(0).withNano(0)
        return if (now.isBefore(todayAt)) todayAt else todayAt.plusDays(1)
    }

    /** 必要なら日付を進めてから、今日のカードを返す。 */
    @Synchronized
    fun today(context: Context): Today {
        val prefs = prefs(context)
        val period = currentPeriod(rolloverTime(context)).toEpochDay()
        val editor = prefs.edit()
        if (!prefs.contains(KEY_PERIOD)) {
            // 初回：両方の山札をシャッフルして1枚目から
            Kind.values().forEach { startCycle(editor, it, cycle = 1, previousLast = -1) }
            editor.putLong(KEY_PERIOD, period)
            editor.commit()
        } else {
            val stored = prefs.getLong(KEY_PERIOD, period)
            if (period > stored) {
                // 切り替え時刻を過ぎた → 次のカードへ（スマホの電源が切れていた日があっても1枚ずつ進める）
                Kind.values().forEach { advance(prefs, editor, it) }
                editor.putLong(KEY_PERIOD, period)
                editor.commit()
            } else if (period < stored) {
                // 時計が巻き戻された場合はカードを進めずに基準日だけ合わせる
                editor.putLong(KEY_PERIOD, period).commit()
            }
        }
        return Today(position(prefs, Kind.PAIN), position(prefs, Kind.WISH))
    }

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun orderKey(kind: Kind) = "${kind.key}_order"
    private fun posKey(kind: Kind) = "${kind.key}_pos"
    private fun cycleKey(kind: Kind) = "${kind.key}_cycle"

    private fun readOrder(prefs: SharedPreferences, kind: Kind): IntArray? {
        val raw = prefs.getString(orderKey(kind), null) ?: return null
        val order = raw.split(',').mapNotNull { it.toIntOrNull() }.toIntArray()
        val valid = order.size == CARD_COUNT && order.sorted() == (0 until CARD_COUNT).toList()
        return if (valid) order else null
    }

    private fun position(prefs: SharedPreferences, kind: Kind): Position {
        val order = readOrder(prefs, kind) ?: IntArray(CARD_COUNT) { it }
        val pos = prefs.getInt(posKey(kind), 0).coerceIn(0, CARD_COUNT - 1)
        return Position(order[pos], pos + 1, prefs.getInt(cycleKey(kind), 1))
    }

    private fun advance(prefs: SharedPreferences, editor: SharedPreferences.Editor, kind: Kind) {
        val order = readOrder(prefs, kind)
        val pos = prefs.getInt(posKey(kind), 0)
        val cycle = prefs.getInt(cycleKey(kind), 1)
        if (order == null) {
            startCycle(editor, kind, cycle, previousLast = -1)
        } else if (pos + 1 >= CARD_COUNT) {
            // 1周完了 → 新しい順番で次の周へ
            startCycle(editor, kind, cycle + 1, previousLast = order[CARD_COUNT - 1])
        } else {
            editor.putInt(posKey(kind), pos + 1)
        }
    }

    private fun startCycle(
        editor: SharedPreferences.Editor,
        kind: Kind,
        cycle: Int,
        previousLast: Int,
    ) {
        val order = (0 until CARD_COUNT).shuffled(Random(System.nanoTime())).toMutableList()
        // 周の変わり目で同じカードが2日続かないようにする
        if (order[0] == previousLast) {
            val swapWith = Random.nextInt(1, CARD_COUNT)
            order[0] = order[swapWith].also { order[swapWith] = order[0] }
        }
        editor.putString(orderKey(kind), order.joinToString(","))
        editor.putInt(posKey(kind), 0)
        editor.putInt(cycleKey(kind), cycle)
    }
}
