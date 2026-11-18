package com.itaminegai.cardwidget

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * カード占いの効果音。音声ファイルを使わず、その場で波形を合成して鳴らす。
 * 音量はスマホの「メディアの音量」に従う（合成した音そのものは最大近くまで大きくしてある）。
 */
class SoundFx {
    private val rate = 44100

    /** 回転中の「ピコッ」 */
    private val tick = track(synth(0.045) { t -> blip(t, 1760.0, decay = 55.0) })

    /** 1枚止まったときの「ピコーン」 */
    private val lock = track(synth(0.42) { t ->
        if (t < 0.07) blip(t, 1318.5, decay = 18.0) else blip(t - 0.07, 1975.5, decay = 7.0)
    })

    /** 2枚そろったときのファンファーレ（ドミソド → 和音のきらきら） */
    private val finale = track(synth(1.6) { t ->
        val notes = doubleArrayOf(1046.5, 1318.5, 1568.0, 2093.0)
        var v = 0.0
        for ((i, f) in notes.withIndex()) {
            val start = i * 0.09
            if (t >= start) v += 0.32 * bell(t - start, f, decay = if (i == notes.lastIndex) 2.2 else 5.0)
        }
        val chordStart = 0.42
        if (t >= chordStart) {
            val u = t - chordStart
            v += 0.22 * bell(u, 2093.0, 2.4) + 0.18 * bell(u, 2637.0, 2.6) + 0.16 * bell(u, 3136.0, 2.8)
            // きらきら（高い音の細かいゆらぎ）
            v += 0.10 * sin(2 * PI * 4186.0 * u) * exp(-u * 3.5) * (0.5 + 0.5 * sin(2 * PI * 18 * u))
        }
        v
    })

    var enabled = true

    fun tick() = play(tick)
    fun lock() = play(lock)
    fun finale() = play(finale)

    fun release() {
        listOf(tick, lock, finale).forEach { it?.release() }
    }

    private fun play(track: AudioTrack?) {
        if (!enabled || track == null) return
        try {
            if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.stop()
            track.reloadStaticData()
            track.play()
        } catch (e: IllegalStateException) {
            // 音が出せなくても遊びは続けられるので無視
        }
    }

    /** 矩形波寄りの電子音（ゲームっぽい「ピコ」）。 */
    private fun blip(t: Double, freq: Double, decay: Double): Double {
        val s = sin(2 * PI * freq * t)
        val square = if (s >= 0) 1.0 else -1.0
        return (0.55 * square + 0.45 * s) * exp(-t * decay)
    }

    /** ベルのような澄んだ音。 */
    private fun bell(t: Double, freq: Double, decay: Double): Double =
        (sin(2 * PI * freq * t) + 0.35 * sin(2 * PI * freq * 2 * t)) * exp(-t * decay)

    private fun synth(seconds: Double, wave: (Double) -> Double): ShortArray {
        val n = (seconds * rate).toInt()
        val raw = DoubleArray(n) { wave(it.toDouble() / rate) }
        // 音割れしない範囲で最大まで持ち上げる
        val peak = raw.maxOf { kotlin.math.abs(it) }.coerceAtLeast(1e-6)
        val gain = 0.92 / peak
        val attack = (0.003 * rate).toInt()
        return ShortArray(n) { i ->
            val fadeIn = if (i < attack) i.toDouble() / attack else 1.0
            val fadeOut = if (i > n - attack) (n - i).toDouble() / attack else 1.0
            (raw[i] * gain * fadeIn * fadeOut * Short.MAX_VALUE).toInt().toShort()
        }
    }

    private fun track(pcm: ShortArray): AudioTrack? = try {
        AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size * 2)
            .build()
            .also { it.write(pcm, 0, pcm.size) }
    } catch (e: Exception) {
        null
    }
}
