package com.reverie.app.ui.screens.browse

import com.reverie.app.data.repository.PageResult

/**
 * The ids a feed has read from the server, page after page from page one, so it can tell when it has
 * read the server's whole list. Only a read in which nothing moved counts: the server's total was the
 * same on every page, and the ids read add up to it (a delete or an upload between two pages shifts the
 * rows, and one of them would be skipped).
 */
class FeedReads private constructor(
    private val ids: Set<String>,
    private val total: Int,
    private val steady: Boolean,
) {
    /** These reads, and then [page] (the next one). */
    operator fun plus(page: PageResult) = FeedReads(ids + page.ids, page.total, steady && page.total == total)

    /**
     * Every id the server returned, once the pages read have reached its end ([loaded] rows so far) in a
     * read that stayed steady; null while the feed has more to read or the read can't be trusted.
     */
    fun idsWhenComplete(loaded: Int): Set<String>? = ids.takeIf { steady && loaded >= total && ids.size == total }

    companion object {
        /** The reads once page one has arrived: a fresh start, whatever came before. */
        fun first(page: PageResult) = FeedReads(page.ids.toSet(), page.total, steady = true)
    }
}
