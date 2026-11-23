package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import java.time.Instant

/**
 * Where a document sits in a tab's order. Lists run newest first, so a larger key is nearer the top;
 * ties on the time break on the id, the same tiebreak the server pages with.
 */
data class SortKey(val millis: Long, val id: String) : Comparable<SortKey> {
    override fun compareTo(other: SortKey): Int = compareValuesBy(this, other, SortKey::millis, SortKey::id)
}

/**
 * How far down one tab has read the server's list. Rows the tab has not reached are missing from the
 * cache even when other rows of the same kind are there (the All tab caches recent uploads, which sit
 * all over a date-taken timeline), so a tab only shows what lies above [frontier].
 */
data class TabCursor(
    /** Rows read from the server so far; the next page starts here. */
    val offset: Int = 0,
    val total: Int = 0,
    /** False until the first page arrives; until then the tab shows whatever the cache holds. */
    val fetched: Boolean = false,
    /** The last row of the last page, in the tab's order; null when the server said the tab is empty. */
    val frontier: SortKey? = null,
    val isLoading: Boolean = false,
    /** True when the last attempt at the first page failed, until the next attempt starts. */
    val failed: Boolean = false,
    /** True when rows were deleted or added since this tab's pages were read: it re-reads page one before it reads on. */
    val stale: Boolean = false,
) {
    val hasMore: Boolean get() = fetched && offset < total
}

/** A tab's rows, in its order, plus the count its subtitle shows; [isLoading] while its first page is in flight. */
data class TabDocuments(
    val documents: List<DocumentDto> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val isLoading: Boolean = false,
    /** True once the server has answered for this tab, so an empty list means the tab is empty. */
    val fetched: Boolean = false,
    /** True when the first page could not be fetched (offline, say): an empty list is then all there is to show. */
    val failed: Boolean = false,
)

/** Epoch milliseconds of an ISO instant; null when it is absent or doesn't parse. */
private fun millisOf(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

/**
 * The key [doc] is ordered by in [tab]: Photos and Videos use the date taken and fall back to the
 * upload time, exactly as the server's `coalesce(taken_at, created_at)` does. The date taken is a
 * local clock reading stored as UTC, and the server compares it as such, so it is compared as such here.
 */
fun sortKeyOf(doc: DocumentDto, tab: BrowseTab): SortKey {
    val created = millisOf(doc.created_at) ?: 0L
    val millis = if (tab == BrowseTab.PHOTOS || tab == BrowseTab.VIDEOS) millisOf(doc.taken_at) ?: created else created
    return SortKey(millis, doc.id)
}

private class Keyed(val doc: DocumentDto, val created: SortKey, val media: SortKey)

/** Splits the one cached list into the four tabs, each in its own order and cut at its frontier. */
object BrowseTabs {

    fun derive(cache: List<DocumentDto>, cursors: Map<BrowseTab, TabCursor>): Map<BrowseTab, TabDocuments> {
        // Parse each row's dates once; the comparators below only compare the parsed keys.
        val rows = cache.map { Keyed(it, sortKeyOf(it, BrowseTab.ALL), sortKeyOf(it, BrowseTab.PHOTOS)) }
        val byUpload = rows.sortedByDescending { it.created }
        val tabs = mapOf(
            BrowseTab.ALL to byUpload.map { it.created to it.doc },
            BrowseTab.PHOTOS to rows.filter { it.doc.kind == DocumentKind.IMAGE }.sortedByDescending { it.media }.map { it.media to it.doc },
            BrowseTab.VIDEOS to rows.filter { it.doc.kind == DocumentKind.VIDEO }.sortedByDescending { it.media }.map { it.media to it.doc },
            BrowseTab.FILES to byUpload.filter { it.doc.kind == DocumentKind.FILE }.map { it.created to it.doc },
        )
        return tabs.mapValues { (tab, keyed) -> toTabDocuments(keyed, cursors[tab] ?: TabCursor()) }
    }

    private fun toTabDocuments(keyed: List<Pair<SortKey, DocumentDto>>, cursor: TabCursor): TabDocuments {
        if (!cursor.fetched) {
            return TabDocuments(keyed.map { it.second }, total = keyed.size, isLoading = cursor.isLoading, failed = cursor.failed)
        }
        // A tab that has read everything (an empty one included) has no unread gaps, so every cached row
        // of its kind belongs to it, uploads that arrived since included. Its total is what it holds.
        if (!cursor.hasMore) {
            val all = keyed.map { it.second }
            return TabDocuments(all, total = all.size, isLoading = cursor.isLoading, fetched = true)
        }
        val frontier = cursor.frontier
        val shown = (if (frontier == null) keyed else keyed.takeWhile { it.first >= frontier }).map { it.second }
        return TabDocuments(shown, total = cursor.total, hasMore = true, isLoading = cursor.isLoading, fetched = true)
    }
}
