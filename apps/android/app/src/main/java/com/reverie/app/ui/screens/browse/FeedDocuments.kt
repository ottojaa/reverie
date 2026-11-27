package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.kind

/**
 * How far down one feed has read the server's list. Rows the feed has not reached are missing from the
 * cache even when other rows of the same kind are there (Recently added caches recent uploads, which sit
 * all over a date-taken timeline), so a feed only shows what lies above [frontier].
 */
data class FeedCursor(
    /** Rows read from the server so far; the next page starts here. */
    val offset: Int = 0,
    val total: Int = 0,
    /** False until the first page arrives; until then the feed shows whatever the cache holds. */
    val fetched: Boolean = false,
    /** The last row of the last page, in the feed's order; null when the server said the feed is empty. */
    val frontier: SortKey? = null,
    val isLoading: Boolean = false,
    /** True when the last attempt at the first page failed, until the next attempt starts. */
    val failed: Boolean = false,
    /** True when rows were deleted or added since this feed's pages were read: it re-reads page one before it reads on. */
    val stale: Boolean = false,
) {
    val hasMore: Boolean get() = fetched && offset < total
}

/** A feed's rows, in its order, plus the server total; [isLoading] while its first page is in flight. */
data class FeedDocuments(
    val documents: List<DocumentDto> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val isLoading: Boolean = false,
    /** True once the server has answered for this feed, so an empty list means the feed is empty. */
    val fetched: Boolean = false,
    /** True when the first page could not be fetched (offline, say): an empty list is then all there is to show. */
    val failed: Boolean = false,
)

/** The rows of the feed of [filter] out of the one cached list: in the order of [sort] and cut at the feed's frontier. */
fun deriveFeed(
    cache: List<DocumentDto>,
    filter: DocumentFilter,
    cursor: FeedCursor,
    sort: DocumentSort = DocumentSort.NEWEST,
): FeedDocuments {
    // Make each row's key once; the sort below only compares the keys.
    val keyed = cache
        .filter { filter.holds(it.kind) }
        .map { sortKeyOf(it, filter, sort) to it }
        .sortedWith(compareBy(sort.order) { it.first })
    if (!cursor.fetched) {
        return FeedDocuments(keyed.map { it.second }, total = keyed.size, isLoading = cursor.isLoading, failed = cursor.failed)
    }
    // A feed that has read everything (an empty one included) has no unread gaps, so every cached row
    // of its kind belongs to it, uploads that arrived since included. Its total is still the server's.
    if (!cursor.hasMore) {
        return FeedDocuments(keyed.map { it.second }, total = cursor.total, isLoading = cursor.isLoading, fetched = true)
    }
    val frontier = cursor.frontier
    val read = if (frontier == null) keyed else keyed.takeWhile { sort.order.compare(it.first, frontier) <= 0 }
    val shown = read.map { it.second }
    return FeedDocuments(shown, total = cursor.total, hasMore = true, isLoading = cursor.isLoading, fetched = true)
}
