package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
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

/** What Browse shows: the open [tab], every tab's rows, the selection and the state of the last fetch. */
data class TabsState(
    val tab: BrowseTab = BrowseTab.ALL,
    /** False until the remembered tab has been read, so the screen doesn't open on All and then jump. */
    val ready: Boolean = false,
    val tabs: Map<BrowseTab, TabDocuments> = emptyMap(),
    val selectedIds: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
) {
    val current: TabDocuments get() = tabs[tab] ?: TabDocuments()
}

private data class Control(
    val tab: BrowseTab = BrowseTab.ALL,
    val ready: Boolean = false,
    val cursors: Map<BrowseTab, TabCursor> = emptyMap(),
    val selectedIds: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
)

private fun Control.cursor(tab: BrowseTab): TabCursor = cursors[tab] ?: TabCursor()

private fun Control.withCursor(tab: BrowseTab, change: (TabCursor) -> TabCursor): Control =
    copy(cursors = cursors + (tab to change(cursor(tab))))

/**
 * The four Browse tabs over one cache observer. [cache] is read once and split into the tabs in a
 * single pass off the main thread; each tab pages the server by its own kind, fetching its first page
 * the first time it is shown. Plain Kotlin (no Android types) so it can be tested on the JVM.
 *
 * @param fetchPage fetches one page of [kind] (every kind when null) into the cache the [cache] flow reads.
 * @param onFirstPageFailed told when the open tab's first page, or a refresh of it, fails; later pages retry silently.
 */
class BrowseTabsModel(
    private val scope: CoroutineScope,
    cache: Flow<List<DocumentDto>>,
    private val fetchPage: suspend (kind: DocumentKind?, offset: Int) -> PageResult,
    private val loadSavedTab: suspend () -> BrowseTab,
    private val saveTab: suspend (BrowseTab) -> Unit,
    private val onFirstPageFailed: (Throwable) -> Unit = {},
    computation: CoroutineDispatcher = Dispatchers.Default,
    sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
) {
    private val control = MutableStateFlow(Control())

    // Selecting rows must not re-sort the library, so the split depends only on the cache and the cursors.
    private val derived: Flow<Map<BrowseTab, TabDocuments>> =
        combine(cache, control.map { it.cursors }.distinctUntilChanged(), BrowseTabs::derive).flowOn(computation)

    val state: StateFlow<TabsState> = combine(derived, control) { tabs, c ->
        TabsState(c.tab, c.ready, tabs, c.selectedIds, c.isRefreshing)
    }.stateIn(scope, sharing, TabsState())

    val selectedIds: Set<String> get() = control.value.selectedIds

    init {
        scope.launch {
            val tab = loadSavedTab()
            control.update { it.copy(tab = tab, ready = true) }
            fetch(tab, offset = 0, refreshing = false)
        }
    }

    /** Opens [tab]: the selection ends (it belongs to the tab it was made in), and a first visit fetches page one. */
    fun selectTab(tab: BrowseTab) {
        if (tab == control.value.tab) return
        control.update { it.copy(tab = tab, selectedIds = emptySet(), isRefreshing = false) }
        scope.launch { saveTab(tab) }
        if (!control.value.cursor(tab).fetched) fetch(tab, offset = 0, refreshing = false)
    }

    /** Re-reads the open tab's first page. [initial] retries a failed first load without the refresh spinner. */
    fun refresh(initial: Boolean = false) = fetch(control.value.tab, offset = 0, refreshing = !initial)

    fun loadMore(tab: BrowseTab = control.value.tab) {
        val cursor = control.value.cursor(tab)
        if (cursor.hasMore) fetch(tab, offset = cursor.offset, refreshing = false)
    }

    fun enterSelection(id: String) = control.update { it.copy(selectedIds = setOf(id)) }

    fun toggleSelect(id: String) = control.update {
        it.copy(selectedIds = if (id in it.selectedIds) it.selectedIds - id else it.selectedIds + id)
    }

    fun clearSelection() = control.update { it.copy(selectedIds = emptySet()) }

    /**
     * The viewer's swipe order: the open tab's documents and nothing else. Its ids follow the tab as
     * pages arrive, and reaching the end asks that same tab for its next page.
     */
    fun prepareSequence(): DocumentSequence {
        val tab = control.value.tab
        fun idsOf(state: TabsState) = state.tabs[tab]?.documents.orEmpty().map(DocumentDto::id)
        return DocumentSequence(
            initialIds = idsOf(state.value),
            ids = state.map(::idsOf).distinctUntilChanged(),
            loadMore = { loadMore(tab) },
        )
    }

    private fun fetch(tab: BrowseTab, offset: Int, refreshing: Boolean) {
        if (control.value.cursor(tab).isLoading) return
        control.update {
            it.withCursor(tab) { cursor -> cursor.copy(isLoading = true, failed = false) }
                .copy(isRefreshing = refreshing)
        }
        scope.launch {
            try {
                val page = fetchPage(tab.kind, offset)
                control.update { it.withCursor(tab) { cursor -> cursor.after(tab, offset, page) }.copy(isRefreshing = false) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                control.update {
                    it.withCursor(tab) { cursor -> cursor.copy(isLoading = false, failed = offset == 0) }.copy(isRefreshing = false)
                }
                // A failed page further down is retried by scrolling again; only a first page or a refresh reports.
                if (offset == 0 && control.value.tab == tab) onFirstPageFailed(error)
            }
        }
    }
}

/** The cursor once [page] (read from [offset]) has arrived. */
private fun TabCursor.after(tab: BrowseTab, offset: Int, page: PageResult): TabCursor {
    val reached = page.last?.let { sortKeyOf(it, tab) }
    return copy(
        // A refresh of page one must not rewind a tab that had read further down.
        offset = if (offset == 0) maxOf(this.offset, page.loaded) else page.loaded,
        total = page.total,
        fetched = true,
        isLoading = false,
        frontier = if (page.total == 0) null else listOfNotNull(frontier, reached).minOrNull(),
    )
}
