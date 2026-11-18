package com.itaminegai.cardwidget

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.LruCache
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.GridView
import android.widget.ImageView
import android.widget.TextView

/** 痛みカード・願いカードの一覧（54枚ずつ）。 */
class CardListActivity : Activity() {

    private lateinit var adapter: CardAdapter
    private lateinit var tabPain: TextView
    private lateinit var tabWish: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_card_list)
        applySystemBarPadding(findViewById(R.id.root))

        adapter = CardAdapter(this)
        findViewById<GridView>(R.id.grid).adapter = adapter

        tabPain = findViewById(R.id.tab_pain)
        tabWish = findViewById(R.id.tab_wish)
        tabPain.setOnClickListener { show(CardDeck.Kind.PAIN) }
        tabWish.setOnClickListener { show(CardDeck.Kind.WISH) }

        val kind = savedInstanceState?.getString(STATE_KIND)
            ?.let { saved -> CardDeck.Kind.values().firstOrNull { it.name == saved } }
            ?: CardDeck.Kind.PAIN
        show(kind)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_KIND, adapter.kind.name)
    }

    private fun show(kind: CardDeck.Kind) {
        tabPain.isSelected = kind == CardDeck.Kind.PAIN
        tabWish.isSelected = kind == CardDeck.Kind.WISH
        adapter.kind = kind
        findViewById<GridView>(R.id.grid).setSelection(0)
    }

    private class CardAdapter(private val context: Context) : BaseAdapter() {
        private val cards = CardResources(context)
        private val today = CardDeck.today(context)
        private val inflater = LayoutInflater.from(context)

        // 一覧用に縮小した画像をキャッシュ（メモリの1/8まで）
        private val cache = object : LruCache<Int, Bitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
            override fun sizeOf(key: Int, value: Bitmap) = value.byteCount
        }

        var kind: CardDeck.Kind = CardDeck.Kind.PAIN
            set(value) {
                field = value
                notifyDataSetChanged()
            }

        override fun getCount() = CardDeck.CARD_COUNT
        override fun getItem(position: Int) = position
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = convertView ?: inflater.inflate(R.layout.item_card, parent, false)
            val resId = cards.image(kind, position)
            view.findViewById<ImageView>(R.id.card_image).apply {
                setImageBitmap(thumbnail(resId))
                contentDescription = cards.text(kind, position)
            }
            val todayIndex = if (kind == CardDeck.Kind.PAIN) today.pain.cardIndex else today.wish.cardIndex
            view.findViewById<TextView>(R.id.card_label).text = context.getString(
                if (position == todayIndex) R.string.card_number_today else R.string.card_number,
                position + 1,
            )
            return view
        }

        private fun thumbnail(resId: Int): Bitmap =
            cache.get(resId) ?: BitmapFactory.decodeResource(
                context.resources, resId,
                BitmapFactory.Options().apply { inSampleSize = 2 },
            ).also { cache.put(resId, it) }
    }

    companion object {
        private const val STATE_KIND = "kind"
    }
}
