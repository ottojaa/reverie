package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.FolderWithChildren
import java.time.Instant

/** What the orders of a feed compare for one document (see [order]). */
data class SortKey(val millis: Long, val id: String, val foldedName: String = "", val sizeBytes: Long = 0)

/** Epoch milliseconds of an ISO instant; null when it is absent or doesn't parse. */
private fun millisOf(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

/**
 * The key [doc] has in the feed of [filter]: a feed of photos and videos dates it by the date taken and
 * falls back to the upload time, exactly as the server's `coalesce(taken_at, created_at)` does; any other
 * feed uses the upload time. The date taken is a local clock reading stored as UTC, and the server
 * compares it as such, so it is compared as such here.
 */
fun sortKeyOf(doc: DocumentDto, filter: DocumentFilter): SortKey {
    val created = millisOf(doc.created_at) ?: 0L
    val millis = if (filter.isByDateTaken) millisOf(doc.taken_at) ?: created else created
    return SortKey(millis, doc.id, foldedName(doc.original_filename), doc.size_bytes)
}

/**
 * A name as it is ordered: only A to Z are lowercased, which is what the server's `lower()` does under
 * the "C" collation.
 */
fun foldedName(name: String): String =
    String(CharArray(name.length) { name[it].let { char -> if (char in 'A'..'Z') char.lowercaseChar() else char } })

/**
 * Compares two strings code point by code point: the order of their UTF-8 bytes, which is how the server
 * compares under the "C" collation. [String.compareTo] compares UTF-16 units and differs above U+FFFF.
 */
fun compareCodePoints(first: String, second: String): Int {
    var at = 0
    while (at < first.length && at < second.length) {
        val a = first.codePointAt(at)
        val b = second.codePointAt(at)
        if (a != b) return a.compareTo(b)
        at += Character.charCount(a)
    }
    return first.length.compareTo(second.length)
}

private val newestFirst: Comparator<SortKey> = compareByDescending<SortKey> { it.millis }.thenByDescending { it.id }

private val byName: Comparator<SortKey> =
    Comparator<SortKey> { a, b -> compareCodePoints(a.foldedName, b.foldedName) }.thenBy { it.id }

private val largestFirst: Comparator<SortKey> =
    compareByDescending<SortKey> { it.sizeBytes }.thenByDescending { it.id }

/**
 * Ranks two keys as the server pages this order: negative when the first is nearer the top of the feed.
 * Ties break on the id as the server breaks them; for [DocumentSort.NEWEST] it does so only for photos and
 * videos, so elsewhere the id is this feed's own tiebreak.
 */
val DocumentSort.order: Comparator<SortKey>
    get() = when (this) {
        DocumentSort.NEWEST -> newestFirst
        DocumentSort.NAME -> byName
        DocumentSort.SIZE -> largestFirst
    }

/** Folders by name, ordered as documents are ordered by theirs. */
val foldersByName: Comparator<FolderWithChildren> =
    Comparator<FolderWithChildren> { a, b -> compareCodePoints(foldedName(a.name), foldedName(b.name)) }.thenBy { it.id }
