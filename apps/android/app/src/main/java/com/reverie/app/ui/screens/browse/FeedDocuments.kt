package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import java.time.Instant

/**
 * Where a document sits in a feed's order. Feeds run newest first, so a larger key is nearer the top.
 * Ties on the time break on the id, as the server pages Photos and Videos; it does not for Files and
 * Recently added, which it orders by upload time alone, so the id is only this feed's own tiebreak there.
 */
data class SortKey(val millis: Long, val id: String) : Comparable<SortKey> {
    override fun compareTo(other: SortKey): Int = compareValuesBy(this, other, SortKey::millis, SortKey::id)
}

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

/** Epoch milliseconds of an ISO instant; null when it is absent or doesn't parse. */
private fun millisOf(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

/**
 * The key [doc] is ordered by in the feed of [kind] (null is Recently added): Photos and Videos use the
 * date taken and fall back to the upload time, exactly as the server's `coalesce(taken_at, created_at)`
 * does. The date taken is a local clock reading stored as UTC, and the server compares it as such, so
 * it is compared as such here.
 */
fun sortKeyOf(doc: DocumentDto, kind: DocumentKind?): SortKey {
    val created = millisOf(doc.created_at) ?: 0L
    val millis = if (kind == DocumentKind.IMAGE || kind == DocumentKind.VIDEO) millisOf(doc.taken_at) ?: created else created
    return SortKey(millis, doc.id)
}

/** The rows of the feed of [kind] (null is Recently added) out of the one cached list: in the feed's own order and cut at its frontier. */
fun deriveFeed(cache: List<DocumentDto>, kind: DocumentKind?, cursor: FeedCursor): FeedDocuments {
    // Parse each row's dates once; the sort below only compares the parsed keys.
    val keyed = cache
        .filter { kind == null || it.kind == kind }
        .map { sortKeyOf(it, kind) to it }
        .sortedByDescending { it.first }
    if (!cursor.fetched) {
        return FeedDocuments(keyed.map { it.second }, total = keyed.size, isLoading = cursor.isLoading, failed = cursor.failed)
    }
    // A feed that has read everything (an empty one included) has no unread gaps, so every cached row
    // of its kind belongs to it, uploads that arrived since included. Its total is still the server's.
    if (!cursor.hasMore) {
        return FeedDocuments(keyed.map { it.second }, total = cursor.total, isLoading = cursor.isLoading, fetched = true)
    }
    val frontier = cursor.frontier
    val shown = (if (frontier == null) keyed else keyed.takeWhile { it.first >= frontier }).map { it.second }
    return FeedDocuments(shown, total = cursor.total, hasMore = true, isLoading = cursor.isLoading, fetched = true)
}
