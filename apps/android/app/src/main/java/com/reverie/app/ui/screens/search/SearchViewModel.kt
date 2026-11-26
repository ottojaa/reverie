package com.reverie.app.ui.screens.search

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.SortBy
import com.reverie.app.data.api.model.SortOrder
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.repository.SearchRepository
import com.reverie.app.ui.screens.viewer.DocumentSequence
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.favourites.FavouriteDeps
import com.reverie.app.ui.screens.manage.ManageController
import com.reverie.app.ui.screens.manage.Selection
import com.reverie.app.ui.screens.viewer.ViewerFocus
import com.reverie.app.domain.search.FilterKey
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.domain.search.addFilter
import com.reverie.app.domain.search.getFilterTokens
import com.reverie.app.domain.search.getFreeText
import com.reverie.app.domain.search.removeFilter
import com.reverie.app.domain.search.replaceFilter
import com.reverie.app.domain.search.setFreeText
import com.reverie.app.domain.search.tokenizeQuery
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Quick filters left out: they carry a kind's name but count what a picture was classified as (screenshots
 * excluded), so their figures would disagree with the Library's, whose cards are the way to those lists.
 */
private val KIND_NAMED_FILTERS = setOf("photos", "videos")

@OptIn(FlowPreview::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository,
    deps: FavouriteDeps,
    private val connectivity: ConnectivityMonitor,
    private val savedState: SavedStateHandle,
) : ViewModel() {

    private val sequenceHolder = deps.sequences

    val favourites = FavouriteController(deps, viewModelScope)

    /** The results selected. */
    val selection = Selection()

    /** Changing what is selected. */
    val manage = ManageController(deps.folders, deps.documents, deps.vault, favourites, viewModelScope)

    /** Starts as the scope the screen was opened with, and its query (a smart view's, say; usually none). */
    private val input = MutableStateFlow(SearchInput(openedWith(savedState)))
    private val control = MutableStateFlow(SearchControl())

    /** What the viewer is showing, so the grid can scroll it into view on return from a viewer opened here. */
    val viewerFocus: StateFlow<ViewerFocus?> get() = sequenceHolder.focus

    /** Consume the focus signal once the grid has scrolled to it, so later list updates don't re-scroll. */
    fun clearViewerFocus() = sequenceHolder.setFocus(null)

    val uiState: StateFlow<SearchUiState> = combine(
        input,
        control,
        searchRepository.observeRecent(),
        connectivity.isOnline,
        deps.folders.observeCached(),
    ) { typed, ctrl, recents, online, folders ->
        val (q, scope) = typed.ask
        SearchUiState(
            query = q,
            freeText = typed.freeText,
            scope = scope,
            folders = folders,
            results = ctrl.results,
            total = ctrl.total,
            facets = ctrl.facets ?: ctrl.baseFacets[scope],
            quickFilters = ctrl.quickFilters,
            recents = recents,
            sortBy = ctrl.sortBy,
            sortOrder = ctrl.sortOrder,
            viewMode = ctrl.userViewMode ?: defaultViewMode(typed.ask, folders),
            isLoading = ctrl.isLoading,
            // True from the first keystroke (before the debounce fires) until the response for the
            // current search lands — so the UI shows a loading bar, not a "No results" flash.
            isSearching = q.isNotBlank() && (ctrl.isLoading || ctrl.answered != typed.ask),
            error = ctrl.error,
            // Track against the server offset, not results.size: de-duping can drop overlapping rows,
            // and gating on the deduped size would keep re-fetching an already-exhausted result set.
            hasMore = ctrl.offset < ctrl.total,
            isOffline = !online,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), openingState(input.value))

    init {
        viewModelScope.launch {
            val filters = runCatching { searchRepository.fetchQuickFilters() }.getOrDefault(emptyList())
            control.update { ctrl -> ctrl.copy(quickFilters = filters.filterNot { it.id in KIND_NAMED_FILTERS }) }
        }
        ensureBaseFacets()
        viewModelScope.launch {
            val asks = input.map { it.ask }.distinctUntilChanged()
            val sorts = control.map { it.sortBy to it.sortOrder }.distinctUntilChanged()
            combine(asks, sorts) { ask, sort -> ask to sort }
                .debounce(300)
                .collect { (ask, sort) -> runSearch(ask, sort.first, sort.second, offset = 0) }
        }
        // Another search lists other things, so what was selected is no longer on show.
        viewModelScope.launch { input.map { it.ask }.distinctUntilChanged().collect { selection.clear() } }
        // A move or a delete changes what is found.
        viewModelScope.launch { deps.documents.contentChanges.collect { searchAgain() } }
        favourites.load()
    }

    private suspend fun searchAgain() {
        val ctrl = control.value
        runSearch(input.value.ask, ctrl.sortBy, ctrl.sortOrder, offset = 0)
    }

    /** Fetch the scope's facets so the filter sheets have options before/without a query. */
    fun ensureBaseFacets() {
        val scope = input.value.ask.scope
        if (scope in control.value.baseFacets) return
        viewModelScope.launch {
            runCatching { searchRepository.facets("", scope) }
                .onSuccess { f -> control.update { it.copy(baseFacets = it.baseFacets + (scope to f)) } }
        }
    }

    /** Searches the whole library from here on, for the same query. */
    fun removeScope() {
        input.update { it.copy(ask = it.ask.copy(scope = SearchScope.Library)) }
        savedState["folder"] = null
        savedState["kind"] = null
        control.update { it.copy(facets = null) }
        ensureBaseFacets()
    }

    private suspend fun runSearch(ask: SearchAsk, sortBy: SortBy, sortOrder: SortOrder, offset: Int) {
        val (q, scope) = ask
        if (q.isBlank()) {
            control.update { it.copy(results = emptyList(), resultsQuery = q, total = 0, facets = null, answered = ask, isLoading = false, error = null, offset = 0) }
            return
        }
        control.update { it.copy(isLoading = offset == 0, error = null) }
        runCatching {
            searchRepository.search(q, scope, PAGE_SIZE, offset, sortBy.wire, sortOrder.wire, includeFacets = offset == 0)
        }.onSuccess { response ->
            // A load-more that resolves after the search moved on would append rows from the old one;
            // drop it — the fresh offset-0 search now owns the state.
            if (offset > 0 && ask != input.value.ask) return@onSuccess
            control.update {
                // distinctBy protects the lazy-list item keys: concurrent load-mores or reshuffled
                // relevance-sorted offset windows can repeat a row, and duplicate keys crash Compose.
                val merged = if (offset == 0) response.results else it.results + response.results
                it.copy(
                    results = merged.distinctBy { it.dedupeKey },
                    resultsQuery = q,
                    total = response.total,
                    facets = if (offset == 0) response.facets ?: it.facets else it.facets,
                    answered = ask,
                    offset = offset + response.results.size,
                    isLoading = false,
                    error = null,
                )
            }
        }.onFailure { t ->
            control.update {
                it.copy(answered = ask, isLoading = false, error = if (connectivity.currentlyOnline()) messageFor(t) else null)
            }
        }
    }

    fun setFreeText(text: String) {
        input.update { SearchInput(it.ask.copy(query = setFreeText(it.ask.query, text)), typed = text) }
    }

    /** Replaces the whole query, filters included: a recent search or a ready-made one. */
    fun setQuery(raw: String) {
        input.update { SearchInput(it.ask.copy(query = raw)) }
    }

    private fun changeQuery(change: (String) -> String) = setQuery(change(input.value.ask.query))

    fun toggleFilter(key: FilterKey, value: String) = changeQuery { current ->
        if (getFilterTokens(tokenizeQuery(current), key).any { it.value.equals(value, ignoreCase = true) }) {
            removeFilter(current, key, value)
        } else {
            addFilter(current, key, value)
        }
    }

    fun replaceFilter(key: FilterKey, value: String?) = changeQuery {
        if (value == null) removeFilter(it, key) else replaceFilter(it, key, value)
    }

    fun clearFilters() = changeQuery { getFreeText(tokenizeQuery(it)) }

    fun currentHasTextMode(): HasTextMode {
        val hasTokens = getFilterTokens(tokenizeQuery(input.value.ask.query), FilterKey.HAS).filter { it.value.equals("text", ignoreCase = true) }
        return when {
            hasTokens.isEmpty() -> HasTextMode.ANY
            hasTokens.any { it.negated } -> HasTextMode.NONE
            else -> HasTextMode.HAS
        }
    }

    fun setHasText(mode: HasTextMode) = changeQuery { current ->
        val base = removeFilter(current, FilterKey.HAS, "text")
        when (mode) {
            HasTextMode.ANY -> base
            HasTextMode.HAS -> addFilter(base, FilterKey.HAS, "text")
            HasTextMode.NONE -> addFilter(base, FilterKey.HAS, "text", negated = true)
        }
    }

    fun setSize(preset: String?) {
        replaceFilter(FilterKey.SIZE, preset)
    }

    /** Keeps what is typed among the recent searches: it was submitted. */
    fun rememberSubmitted() = record(input.value.ask.query)

    /**
     * Keeps the query of the results on show among the recent searches: one of them was opened. More may
     * have been typed since, with its own results still on their way.
     */
    fun rememberOpened() = record(control.value.resultsQuery)

    private fun record(query: String) {
        viewModelScope.launch { searchRepository.recordSearch(query) }
    }

    fun removeRecent(recent: String) {
        viewModelScope.launch { searchRepository.removeRecent(recent) }
    }

    fun setSort(sortBy: SortBy) {
        control.update {
            if (it.sortBy == sortBy) it.copy(sortOrder = if (it.sortOrder == SortOrder.DESC) SortOrder.ASC else SortOrder.DESC)
            else it.copy(sortBy = sortBy, sortOrder = SortOrder.DESC)
        }
    }

    fun setViewMode(mode: ViewMode) {
        control.update { it.copy(userViewMode = mode) }
    }

    /**
     * Hand the current document results (collections excluded) to the viewer so it can swipe through
     * them. Call right before opening a result. [ids] stays live so the pager grows as we [loadMore].
     */
    fun prepareSequence() {
        val documentIds: (SearchUiState) -> List<String> = { state ->
            state.results.filterIsInstance<DocumentSearchResult>().map { it.document_id }
        }
        sequenceHolder.set(
            DocumentSequence(
                initialIds = documentIds(uiState.value),
                ids = uiState.map(documentIds).distinctUntilChanged(),
                loadMore = ::loadMore,
            ),
        )
    }

    fun loadMore() {
        val ctrl = control.value
        val ask = input.value.ask
        // Results of an earlier search are still on show while this one is on its way: nothing to add to them.
        if (ctrl.answered != ask) return
        if (ctrl.isLoading || ctrl.isLoadingMore || ctrl.offset >= ctrl.total) return
        // Flip the guard synchronously (loadMore is called from the main-thread scroll collector) so
        // a burst of scroll triggers can't launch overlapping fetches of the same page.
        control.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            try {
                runSearch(ask, ctrl.sortBy, ctrl.sortOrder, ctrl.offset)
            } finally {
                control.update { it.copy(isLoadingMore = false) }
            }
        }
    }

    private fun messageFor(throwable: Throwable): String =
        (throwable as? ReverieApiException)?.userMessage() ?: "Search failed."

    private companion object {
        const val PAGE_SIZE = 20

        fun openedWith(savedState: SavedStateHandle): SearchAsk {
            val folderId = savedState.get<String>("folder")
            val kind = DocumentKind.ofWire(savedState.get<String>("kind"))
            val scope = when {
                folderId != null -> SearchScope.Folder(folderId)
                kind != null -> SearchScope.Kind(kind)
                else -> SearchScope.Library
            }
            return SearchAsk(savedState.get<String>("q").orEmpty(), scope)
        }
    }
}
