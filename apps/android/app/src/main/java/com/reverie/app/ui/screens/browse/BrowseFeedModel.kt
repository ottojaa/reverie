package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.screens.manage.Selection
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.repository.PageResult
import com.reverie.app.ui.screens.viewer.DocumentSequence
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

/** Documents per page of every Browse list. */
const val BROWSE_PAGE_SIZE = 30

/** One feed's rows, its selection and whether a pull-to-refresh is running. */
data class FeedState(
    val documents: FeedDocuments = FeedDocuments(),
    val selectedIds: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
)

private data class Control(
    val cursor: FeedCursor = FeedCursor(),
    val isRefreshing: Boolean = false,
)

/**
 * One list of documents over the cache observer [cache]. It pages the server for the kinds of [filter],
 * starting with page one as soon as it is made, and shows the cached rows that lie above how far it has
 * read. Plain Kotlin (no Android types) so it can be tested on the JVM.
 *
 * @param fetchPage fetches one page of [filter] from [offset] into the cache the [cache] flow reads.
 * @param reconcile told, with the ids the server returned, when the feed has read its whole list from the
 *   server in one steady read: the caller drops the cached rows of this feed's kind that are not among them.
 * @param onFirstPageFailed told when the first page, or a refresh of it, fails; later pages retry silently.
 *   A preview feed leaves it unset, so an offline open reports the failure once and not once per feed.
 */
class BrowseFeedModel(
    private val scope: CoroutineScope,
    val filter: DocumentFilter,
    cache: Flow<List<DocumentDto>>,
    private val fetchPage: suspend (offset: Int) -> PageResult,
    private val onFirstPageFailed: (Throwable) -> Unit = {},
    private val reconcile: suspend (readIds: Set<String>) -> Unit = {},
    computation: CoroutineDispatcher = Dispatchers.Default,
    sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
    val selection: Selection = Selection(),
    /** The order [fetchPage] pages in. */
    private val sort: DocumentSort = DocumentSort.NEWEST,
) {
    private val control = MutableStateFlow(Control())
    private var reads: FeedReads? = null

    // Selecting rows must not re-sort the library, so the rows depend only on the cache and the cursor.
    private val derived: Flow<FeedDocuments> =
        combine(cache, control.map { it.cursor }.distinctUntilChanged()) { docs, cursor ->
            deriveFeed(docs, filter, cursor, sort)
        }
            .flowOn(computation)

    val state: StateFlow<FeedState> = combine(derived, control, selection.ids) { documents, c, selectedIds ->
        FeedState(documents, selectedIds, c.isRefreshing)
    }.stateIn(scope, sharing, FeedState())

    init {
        fetch(offset = 0, refreshing = false)
    }

    /** Re-reads page one. [initial] retries a failed first load without the refresh spinner. */
    fun refresh(initial: Boolean = false) = fetch(offset = 0, refreshing = !initial)

    /**
     * Documents were deleted or added: the feed re-reads page one now. It is marked stale too: if a
     * page is in flight and the refresh is dropped, its next load starts over.
     */
    fun contentChanged() {
        control.update { c -> if (c.cursor.fetched) c.copy(cursor = c.cursor.copy(stale = true)) else c }
        refresh(initial = true)
    }

    fun loadMore() {
        val cursor = control.value.cursor
        // A stale feed's offset no longer matches the server's rows, so it starts over rather than reading on.
        if (cursor.stale) return fetch(offset = 0, refreshing = false)
        if (cursor.hasMore) fetch(offset = cursor.offset, refreshing = false)
    }

    /**
     * The viewer's swipe order: this feed's loaded documents and nothing else. Its ids follow the feed as
     * pages arrive, and reaching the end asks this same feed for its next page.
     *
     * @param order the ids in the order the screen shows them, where that differs from the feed's own.
     */
    fun prepareSequence(
        order: (List<DocumentDto>) -> List<String> = { documents -> documents.map { it.id } },
    ): DocumentSequence {
        fun idsOf(state: FeedState) = order(state.documents.documents)
        return DocumentSequence(
            initialIds = idsOf(state.value),
            ids = state.map(::idsOf).distinctUntilChanged(),
            loadMore = ::loadMore,
        )
    }

    private fun fetch(offset: Int, refreshing: Boolean) {
        val before = control.value.cursor
        if (before.isLoading) return
        control.update { it.copy(cursor = it.cursor.copy(isLoading = true, failed = false), isRefreshing = refreshing) }
        scope.launch {
            try {
                val page = fetchPage(offset)
                val reached = page.last?.let { sortKeyOf(it, filter) }
                control.update { it.copy(cursor = it.cursor.after(reached, sort, offset, page), isRefreshing = false) }
                // Page one starts the reads over; a later page adds to them (there are none before page one).
                val read = if (offset == 0) FeedReads.first(page) else reads?.plus(page)
                reads = read
                // A feed made stale mid-read has rows moving under it: it reconciles on the read that follows.
                if (!control.value.cursor.stale) read?.idsWhenComplete(page.loaded)?.let { reconcileQuietly(it) }
                // After a refresh the offset starts over while the frontier stays deep, so the pages up to the old
                // depth bring nothing new on screen and the feed would never ask for another: read straight on.
                val now = control.value.cursor
                val addedNothing = offset > 0 && before.frontier != null && now.frontier == before.frontier
                if (addedNothing && now.hasMore && !now.stale && now.offset > offset) loadMore()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                control.update { it.copy(cursor = it.cursor.copy(isLoading = false, failed = offset == 0), isRefreshing = false) }
                // A failed page further down is retried by scrolling again; only a first page or a refresh reports.
                if (offset == 0) onFirstPageFailed(error)
            }
        }
    }

    /** Dropping rows the server no longer has is housekeeping: when it fails, the next full read tries again. */
    private suspend fun reconcileQuietly(readIds: Set<String>) {
        try {
            reconcile(readIds)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Best effort, as above.
        }
    }
}

/** Runs [read]; a failure (offline, or the server is down) is dropped, so whatever is shown stays. */
internal fun CoroutineScope.readQuietly(read: suspend () -> Unit) {
    launch {
        try {
            read()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Nothing to report: see above.
        }
    }
}

/** The cursor once [page] (read from [offset], reaching down to [reached] in [sort]'s order) has arrived. */
private fun FeedCursor.after(reached: SortKey?, sort: DocumentSort, offset: Int, page: PageResult): FeedCursor =
    copy(
        // Page one starts the offset over: rows may have been deleted since, so the old offset could
        // step over rows that moved up. The frontier keeps the furthest row reached, so nothing already
        // shown disappears; the next page re-reads rows that are cached, which only upserts them.
        offset = page.loaded,
        stale = stale && offset != 0,
        total = page.total,
        fetched = true,
        isLoading = false,
        frontier = if (page.total == 0) null else listOfNotNull(frontier, reached).maxWithOrNull(sort.order),
    )
