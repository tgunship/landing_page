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
 * - 1日の区切りは毎日 20:00（20:00 から翌日 19:59 までが同じカード）
 */
object CardDeck {
    const val CARD_COUNT = 54
    val ROLLOVER_TIME: LocalTime = LocalTime.of(20, 0)

    private const val PREFS = "card_deck"
    private const val KEY_PERIOD = "period_epoch_day"

    enum class Kind(val key: String) { PAIN("pain"), WISH("wish") }

    data class Position(val cardIndex: Int, val dayInCycle: Int, val cycle: Int)

    data class Today(val pain: Position, val wish: Position)

    /** 今の時刻が属する「日」（直近の 20:00 が属する日付）。 */
    fun currentPeriod(now: ZonedDateTime = ZonedDateTime.now()): LocalDate {
        val today = now.toLocalDate()
        return if (now.toLocalTime() >= ROLLOVER_TIME) today else today.minusDays(1)
    }

    /** 次にカードが切り替わる時刻。 */
    fun nextRollover(now: ZonedDateTime = ZonedDateTime.now()): ZonedDateTime {
        val todayAt = now.with(ROLLOVER_TIME).withSecond(0).withNano(0)
        return if (now.isBefore(todayAt)) todayAt else todayAt.plusDays(1)
    }

    /** 必要なら日付を進めてから、今日のカードを返す。 */
    @Synchronized
    fun today(context: Context): Today {
        val prefs = prefs(context)
        val period = currentPeriod().toEpochDay()
        val editor = prefs.edit()
        if (!prefs.contains(KEY_PERIOD)) {
            // 初回：両方の山札をシャッフルして1枚目から
            Kind.values().forEach { startCycle(editor, it, cycle = 1, previousLast = -1) }
            editor.putLong(KEY_PERIOD, period)
            editor.commit()
        } else {
            val stored = prefs.getLong(KEY_PERIOD, period)
            if (period > stored) {
                // 20:00 を過ぎた → 次のカードへ（スマホの電源が切れていた日があっても1枚ずつ進める）
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
