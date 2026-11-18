package com.itaminegai.cardwidget

import android.content.Context

/** カード番号（0〜53）から画像リソースとカードの言葉を引く。 */
class CardResources(context: Context) {
    private val res = context.resources

    private val painImages = ids(R.array.pain_cards)
    private val wishImages = ids(R.array.wish_cards)
    private val painTexts = res.getStringArray(R.array.pain_texts)
    private val wishTexts = res.getStringArray(R.array.wish_texts)

    fun image(kind: CardDeck.Kind, index: Int): Int =
        if (kind == CardDeck.Kind.PAIN) painImages[index] else wishImages[index]

    fun text(kind: CardDeck.Kind, index: Int): String =
        (if (kind == CardDeck.Kind.PAIN) painTexts[index] else wishTexts[index]).replace('\n', '・')

    private fun ids(arrayRes: Int): IntArray {
        val typed = res.obtainTypedArray(arrayRes)
        try {
            return IntArray(typed.length()) { typed.getResourceId(it, 0) }
        } finally {
            typed.recycle()
        }
    }
}
