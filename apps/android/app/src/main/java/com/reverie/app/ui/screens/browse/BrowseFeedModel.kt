package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
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

/** One feed's rows, its selection and whether a pull-to-refresh is running. */
data class FeedState(
    val documents: TabDocuments = TabDocuments(),
    val selectedIds: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
)

private data class Control(
    val cursor: TabCursor = TabCursor(),
    val selectedIds: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
)

/**
 * One list of Browse (the dashboard's Recently added, a picture card's preview, or a kind screen)
 * over the cache observer [cache]. It pages the server for [tab]'s kind, starting with page one as
 * soon as it is made, and shows the cached rows that lie above how far it has read. Plain Kotlin (no
 * Android types) so it can be tested on the JVM.
 *
 * @param fetchPage fetches one page of [tab]'s kind from [offset] into the cache the [cache] flow reads.
 * @param onFirstPageFailed told when the first page, or a refresh of it, fails; later pages retry silently.
 *   A preview feed leaves it unset, so an offline open reports the failure once and not once per feed.
 */
class BrowseFeedModel(
    private val scope: CoroutineScope,
    val tab: BrowseTab,
    cache: Flow<List<DocumentDto>>,
    private val fetchPage: suspend (offset: Int) -> PageResult,
    private val onFirstPageFailed: (Throwable) -> Unit = {},
    computation: CoroutineDispatcher = Dispatchers.Default,
    sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
) {
    private val control = MutableStateFlow(Control())

    // Selecting rows must not re-sort the library, so the rows depend only on the cache and the cursor.
    private val derived: Flow<TabDocuments> =
        combine(cache, control.map { it.cursor }.distinctUntilChanged()) { docs, cursor -> BrowseTabs.derive(docs, tab, cursor) }
            .flowOn(computation)

    val state: StateFlow<FeedState> = combine(derived, control) { documents, c ->
        FeedState(documents, c.selectedIds, c.isRefreshing)
    }.stateIn(scope, sharing, FeedState())

    val selectedIds: Set<String> get() = control.value.selectedIds

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

    fun enterSelection(ids: Collection<String>) = control.update { it.copy(selectedIds = ids.toSet()) }

    /** Selects [ids] together, or deselects them all when every one is already selected (a fold or stack row). */
    fun toggleSelect(ids: Collection<String>) = control.update {
        val all = it.selectedIds.containsAll(ids)
        it.copy(selectedIds = if (all) it.selectedIds - ids.toSet() else it.selectedIds + ids)
    }

    fun clearSelection() = control.update { it.copy(selectedIds = emptySet()) }

    /**
     * The viewer's swipe order: this feed's loaded documents and nothing else. Its ids follow the feed as
     * pages arrive, and reaching the end asks this same feed for its next page.
     */
    fun prepareSequence(): DocumentSequence {
        fun idsOf(state: FeedState) = state.documents.documents.map(DocumentDto::id)
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
                control.update { it.copy(cursor = it.cursor.after(tab, offset, page), isRefreshing = false) }
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
}

/** The cursor once [page] (read from [offset]) has arrived. */
private fun TabCursor.after(tab: BrowseTab, offset: Int, page: PageResult): TabCursor {
    val reached = page.last?.let { sortKeyOf(it, tab) }
    return copy(
        // Page one starts the offset over: rows may have been deleted since, so the old offset could
        // step over rows that moved up. The frontier keeps its minimum, so nothing already shown
        // disappears; the next page re-reads rows that are cached, which only upserts them.
        offset = page.loaded,
        stale = stale && offset != 0,
        total = page.total,
        fetched = true,
        isLoading = false,
        frontier = if (page.total == 0) null else listOfNotNull(frontier, reached).minOrNull(),
    )
}
