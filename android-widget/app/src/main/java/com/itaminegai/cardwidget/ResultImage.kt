package com.itaminegai.cardwidget

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** カード占いの結果を1枚の画像にして、保存・共有する。 */
object ResultImage {
    private const val W = 1080
    private const val PAD = 72
    private const val ALBUM = "痛みと願いカード"

    fun render(context: Context, painIndex: Int, wishIndex: Int, result: String, prompt: String): Bitmap {
        val res = context.resources
        val cards = CardResources(context)
        val teal = context.getColor(R.color.teal)
        val ink = context.getColor(R.color.ink)
        val sub = context.getColor(R.color.sub)
        val cardW = W - PAD * 2
        val cardH = cardW * 624 / 960

        fun text(size: Float, color: Int, bold: Boolean = false) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size
            this.color = color
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        fun layout(s: String, p: TextPaint, width: Int, align: Layout.Alignment = Layout.Alignment.ALIGN_CENTER) =
            StaticLayout.Builder.obtain(s, 0, s.length, p, width).setAlignment(align)
                .setLineSpacing(0f, 1.35f).build()

        val resultLayout = layout(result, text(44f, ink, bold = true), cardW)
        val promptLayout = layout(prompt, text(38f, ink), cardW - 80)

        // 高さを計算してからキャンバスを作る
        val headerH = 190
        val labelH = 64
        val promptBoxH = 70 + 56 + promptLayout.height + 50
        val height = headerH + (labelH + cardH + 40) * 2 + resultLayout.height + 60 + promptBoxH + 140
        val bmp = Bitmap.createBitmap(W, height, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(context.getColor(R.color.screen))

        // ヘッダー
        var y = 80f
        val title = text(56f, teal, bold = true)
        c.drawText(ALBUM, PAD.toFloat(), y + 50, title)
        val date = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy年M月d日(E)", Locale.JAPANESE))
        val datePaint = text(34f, sub)
        c.drawText(date, (W - PAD - datePaint.measureText(date)), y + 46, datePaint)
        y = headerH.toFloat()

        fun drawCard(label: String, resId: Int) {
            c.drawText(label, PAD.toFloat(), y + 40, text(34f, sub, bold = true))
            y += labelH
            val card = BitmapFactory.decodeResource(res, resId)
            // うっすら影
            val shadow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(28, 0, 0, 0) }
            c.drawRoundRect(RectF(PAD + 4f, y + 10, PAD + cardW + 4f, y + cardH + 10), 36f, 36f, shadow)
            c.drawBitmap(card, null, RectF(PAD.toFloat(), y, (PAD + cardW).toFloat(), y + cardH), Paint(Paint.FILTER_BITMAP_FLAG))
            card.recycle()
            y += cardH + 40
        }
        drawCard(context.getString(R.string.label_pain), cards.image(CardDeck.Kind.PAIN, painIndex))
        drawCard(context.getString(R.string.label_wish), cards.image(CardDeck.Kind.WISH, wishIndex))

        c.save(); c.translate(PAD.toFloat(), y); resultLayout.draw(c); c.restore()
        y += resultLayout.height + 60

        // お題
        val box = RectF(PAD.toFloat(), y, (W - PAD).toFloat(), y + promptBoxH)
        c.drawRoundRect(box, 36f, 36f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = context.getColor(R.color.teal_soft) })
        val promptTitle = text(32f, teal, bold = true)
        val pt = context.getString(R.string.prompt_title)
        c.drawText(pt, W / 2f - promptTitle.measureText(pt) / 2, y + 70, promptTitle)
        c.save(); c.translate(PAD + 40f, y + 70 + 56); promptLayout.draw(c); c.restore()
        y += promptBoxH

        val footer = text(28f, sub)
        val ft = context.getString(R.string.image_footer)
        c.drawText(ft, W / 2f - footer.measureText(ft) / 2, y + 90, footer)
        return bmp
    }

    /** 端末の写真フォルダ（Pictures/痛みと願いカード）に保存する。 */
    fun save(context: Context, bmp: Bitmap): Uri? {
        val name = "itami_negai_${System.currentTimeMillis()}.png"
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM)
                put(MediaStore.Images.Media.IS_PENDING, 1)
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM)
                dir.mkdirs()
                @Suppress("DEPRECATION")
                put(MediaStore.Images.Media.DATA, File(dir, name).absolutePath)
            }
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
        return try {
            resolver.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            }
            uri
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            null
        }
    }

    /** アプリ内の一時ファイルに書き出して、共有シートを開く（写真フォルダには残さない）。 */
    fun share(context: Context, bmp: Bitmap) {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val file = File(dir, "itami_negai_result.png")
        FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, context.getString(R.string.share_chooser)))
    }
}
