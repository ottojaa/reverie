package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.components.MosaicSection
import com.reverie.app.ui.components.bandKey
import com.reverie.app.ui.components.computeSections

/** Where a file sits in the All tab's rounded card; each row rounds its own corners so the card can still scroll lazily. */
enum class CardSlot { ONLY, FIRST, MIDDLE, LAST }

/** One entry of a tab's lazy list. Every tab renders the same rows, only the mix differs. */
sealed interface FeedRow {
    /** Unique within the list: it keeps scroll position and animations attached to the right row. */
    val key: String

    /** Compose reuses a row's layout only for rows of the same type. */
    val contentType: String

    /** The documents this row draws, so the list can find where one is. */
    val docIds: List<String>

    data class Heading(override val key: String, val header: FeedItem.Header) : FeedRow {
        override val contentType get() = "heading"
        override val docIds get() = emptyList<String>()
    }

    data class Band(val section: MosaicSection) : FeedRow {
        override val key get() = section.bandKey()
        override val contentType get() = "band"
        override val docIds get() = section.tiles.map { it.doc.id }
    }

    data class Videos(val docs: List<DocumentDto>) : FeedRow {
        override val key get() = "videos:" + docs.first().id
        override val contentType get() = "videos"
        override val docIds get() = docs.map { it.id }
    }

    /** A file row; [slot] is null in the Files tab, where rows stand on the page instead of in a card. */
    data class File(val doc: DocumentDto, val slot: CardSlot?) : FeedRow {
        override val key get() = "file:" + doc.id
        override val contentType get() = if (slot == null) "file" else "card-file"
        override val docIds get() = listOf(doc.id)
    }
}

/** Fetch the next page once the last visible row is this close to the end of what is loaded. */
private const val LOAD_AHEAD_ROWS = 3

/**
 * Flattens [feed] into lazy-list rows for a [width]-dp-wide screen. Photo runs are packed by the
 * user's layout setting; a file card becomes one row per file so a long day doesn't compose at once.
 */
fun toRows(feed: List<FeedItem>, width: Float, layoutMode: GridLayoutMode, featureEvery: Int): List<FeedRow> {
    val headings = mutableMapOf<String, Int>()
    return feed.flatMap { item ->
        when (item) {
            is FeedItem.Header -> {
                // A group can come back after another one (a photo with no date taken, between two taken
                // in the same month), so the key counts its occurrences.
                val nth = headings.merge(item.key, 1, Int::plus)
                listOf(FeedRow.Heading("heading:${item.key}:$nth", item))
            }
            is FeedItem.Media -> computeSections(item.docs, width, layoutMode, featureEvery).map { FeedRow.Band(it) }
            is FeedItem.VideoRow -> listOf(FeedRow.Videos(item.docs))
            is FeedItem.FileRow -> listOf(FeedRow.File(item.doc, slot = null))
            is FeedItem.FileCard -> item.docs.mapIndexed { index, doc -> FeedRow.File(doc, cardSlotOf(index, item.docs.size)) }
        }
    }
}

private fun cardSlotOf(index: Int, size: Int): CardSlot = when {
    size == 1 -> CardSlot.ONLY
    index == 0 -> CardSlot.FIRST
    index == size - 1 -> CardSlot.LAST
    else -> CardSlot.MIDDLE
}

/** The list index of the row drawing [docId], or -1 when it isn't loaded in this tab. */
fun rowIndexOf(rows: List<FeedRow>, docId: String): Int = rows.indexOfFirst { docId in it.docIds }

/** Whether scrolling has reached the end of a tab that has another page to load. */
fun isNearEnd(lastVisibleIndex: Int, rowCount: Int, hasMore: Boolean): Boolean =
    hasMore && lastVisibleIndex >= rowCount - LOAD_AHEAD_ROWS

/** The group heading the row at [index] sits under: the nearest heading at or above it. */
fun headingAt(rows: List<FeedRow>, index: Int): FeedItem.Header? =
    (index.coerceIn(0, (rows.size - 1).coerceAtLeast(0)) downTo 0)
        .firstNotNullOfOrNull { rows.getOrNull(it) as? FeedRow.Heading }
        ?.header
