package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.components.MosaicSection
import com.reverie.app.ui.components.bandKey
import com.reverie.app.ui.components.computeSections
import java.time.ZoneId

/** One entry of a document list's lazy list. */
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

    data class File(val doc: DocumentDto) : FeedRow {
        override val key get() = "file:" + doc.id
        override val contentType get() = "file"
        override val docIds get() = listOf(doc.id)
    }

    /** A row that says when a document, or a group of them, was added. */
    data class Added(val entry: RecentEntry) : FeedRow {
        override val key get() = "added:" + entry.key
        override val contentType get() = "added"
        override val docIds get() = when (entry) {
            is RecentEntry.Member -> listOf(entry.doc.id)
            // An opened group's documents are the member rows under it.
            is RecentEntry.Row -> if (entry.expanded) emptyList() else entry.row.docIds()
        }
    }
}

/** Fetch the next page once the last visible row is this close to the end of what is loaded. */
private const val LOAD_AHEAD_ROWS = 3

/** Flattens [feed] into lazy-list rows for a [width]-dp-wide screen, packing each day's photos by the grid setting. */
fun toRows(feed: List<FeedItem>, width: Float, layoutMode: GridLayoutMode, featureEvery: Int): List<FeedRow> =
    feed.flatMap { item ->
        when (item) {
            is FeedItem.Header -> listOf(FeedRow.Heading("heading:" + item.key, item))
            is FeedItem.Media -> computeSections(item.docs, width, layoutMode, featureEvery).map { FeedRow.Band(it) }
            is FeedItem.FileRow -> listOf(FeedRow.File(item.doc))
        }
    }

/** The rows of [source]'s screen over [documents]; [expanded] holds the keys of the groups opened in a folded list. */
fun feedRows(
    source: FeedSource,
    documents: List<DocumentDto>,
    expanded: Set<String>,
    width: Float,
    layout: FeedLayout,
): List<FeedRow> = when (source.style) {
    FeedStyle.DAYS -> toRows(
        buildFeed(source.filter, documents, layout.today, layout.zone), width, layout.mode, layout.featureEvery,
    )
    FeedStyle.ROWS -> documents.map { FeedRow.Added(RecentEntry.Row(RecentRow.Single(it))) }
    FeedStyle.FOLDS -> recentEntries(recentRows(documents), expanded).map { FeedRow.Added(it) }
}

/**
 * The ids of [documents] in the order [source]'s screen shows them, which is the viewer's swipe order. In a
 * folded list a closed group is one item (its newest document).
 */
fun shownIds(source: FeedSource, documents: List<DocumentDto>, expanded: Set<String>, zone: ZoneId): List<String> =
    when (source.style) {
        FeedStyle.DAYS -> byDay(source.filter, documents, zone).flatMap { (_, day) -> day.map { it.id } }
        FeedStyle.ROWS -> documents.map { it.id }
        FeedStyle.FOLDS -> viewerIds(recentRows(documents), expanded)
    }

/** The list index of the row drawing [docId], or -1 when it isn't loaded in this list. */
fun rowIndexOf(rows: List<FeedRow>, docId: String): Int = rows.indexOfFirst { docId in it.docIds }

/** Whether scrolling has reached the end of a list that has another page to load. */
fun isNearEnd(lastVisibleIndex: Int, rowCount: Int, hasMore: Boolean): Boolean =
    hasMore && lastVisibleIndex >= rowCount - LOAD_AHEAD_ROWS

/** The group heading the row at [index] sits under: the nearest heading at or above it. */
fun headingAt(rows: List<FeedRow>, index: Int): FeedItem.Header? =
    (index.coerceIn(0, (rows.size - 1).coerceAtLeast(0)) downTo 0)
        .firstNotNullOfOrNull { rows.getOrNull(it) as? FeedRow.Heading }
        ?.header
