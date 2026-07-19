package com.reverie.app.ui.screens.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.CollectionSearchResult
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.data.api.model.SearchHit
import com.reverie.app.data.api.model.SortBy
import com.reverie.app.data.api.model.SortOrder
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.repository.SearchRepository
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.ui.screens.viewer.DocumentSequence
import com.reverie.app.ui.screens.viewer.DocumentSequenceHolder
import com.reverie.app.domain.search.FilterKey
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

enum class ViewMode { LIST, GRID }

enum class HasTextMode { ANY, HAS, NONE }

data class SearchUiState(
    val query: String = "",
    val freeText: String = "",
    val results: List<SearchHit> = emptyList(),
    val total: Int = 0,
    val facets: SearchFacets? = null,
    val quickFilters: List<QuickFilter> = emptyList(),
    val recents: List<String> = emptyList(),
    val sortBy: SortBy = SortBy.RELEVANCE,
    val sortOrder: SortOrder = SortOrder.DESC,
    val viewMode: ViewMode = ViewMode.LIST,
    val isLoading: Boolean = false,
    val isSearching: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = false,
    val isOffline: Boolean = false,
) {
    val hasQuery: Boolean get() = query.isNotBlank()
    fun activeValues(key: FilterKey): List<String> =
        getFilterTokens(tokenizeQuery(query), key).map { it.value }
}

private data class SearchControl(
    val results: List<SearchHit> = emptyList(),
    val total: Int = 0,
    val facets: SearchFacets? = null,
    // Whole-library facets, fetched once, so the filter sheets have options before/without a query.
    val baseFacets: SearchFacets? = null,
    // The query the current [results] belong to; lets the UI tell "typing, results are stale" apart
    // from "searched, genuinely empty" so it never flashes "No results" during the debounce.
    val resultsQuery: String? = null,
    val quickFilters: List<QuickFilter> = emptyList(),
    val sortBy: SortBy = SortBy.RELEVANCE,
    val sortOrder: SortOrder = SortOrder.DESC,
    val userViewMode: ViewMode? = null,
    val offset: Int = 0,
    val isLoading: Boolean = false,
    // In-flight guard for pagination: unlike [isLoading] (offset-0 only), this serializes load-more
    // so concurrent scroll triggers can't refetch and re-append the same page.
    val isLoadingMore: Boolean = false,
    val error: String? = null,
)

/** Stable identity for de-duping merged pages; must match the LazyColumn/LazyGrid item keys. */
private val SearchHit.dedupeKey: String
    get() = when (this) {
        is DocumentSearchResult -> "doc:$document_id"
        is CollectionSearchResult -> "col:$id"
    }

@OptIn(FlowPreview::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository,
    private val connectivity: ConnectivityMonitor,
    private val sequenceHolder: DocumentSequenceHolder,
    settingsRepository: SettingsRepository,
) : ViewModel() {

    private val query = MutableStateFlow("")
    private val control = MutableStateFlow(SearchControl())

    /** User-chosen grid column count (1–4), shared with the Files grid so both stay in lockstep. */
    val gridColumns: StateFlow<Int> = settingsRepository.settings
        .map { it.gridColumns }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 3)

    /** The document the viewer is showing, so the grid can scroll it into view on return. */
    val focusedDocumentId: StateFlow<String?> get() = sequenceHolder.focused

    /** Consume the focus signal once the grid has scrolled to it, so later list updates don't re-scroll. */
    fun clearFocusedDocument() = sequenceHolder.setFocused(null)

    val uiState: StateFlow<SearchUiState> = combine(
        query,
        control,
        searchRepository.observeRecent(),
        connectivity.isOnline,
    ) { q, ctrl, recents, online ->
        SearchUiState(
            query = q,
            freeText = getFreeText(tokenizeQuery(q)),
            results = ctrl.results,
            total = ctrl.total,
            facets = ctrl.facets ?: ctrl.baseFacets,
            quickFilters = ctrl.quickFilters,
            recents = recents,
            sortBy = ctrl.sortBy,
            sortOrder = ctrl.sortOrder,
            viewMode = ctrl.userViewMode ?: if (isPhotoish(q)) ViewMode.GRID else ViewMode.LIST,
            isLoading = ctrl.isLoading,
            // True from the first keystroke (before the debounce fires) until the response for the
            // current query lands — so the UI shows a loading bar, not a "No results" flash.
            isSearching = q.isNotBlank() && (ctrl.isLoading || ctrl.resultsQuery != q),
            error = ctrl.error,
            // Track against the server offset, not results.size: de-duping can drop overlapping rows,
            // and gating on the deduped size would keep re-fetching an already-exhausted result set.
            hasMore = ctrl.offset < ctrl.total,
            isOffline = !online,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchUiState())

    init {
        viewModelScope.launch {
            val filters = searchRepository.quickFilters()
            control.update { it.copy(quickFilters = filters) }
        }
        ensureBaseFacets()
        viewModelScope.launch {
            combine(query, control.map { it.sortBy to it.sortOrder }.distinctUntilChanged()) { q, sort -> Triple(q, sort.first, sort.second) }
                .debounce(300)
                .collect { (q, sortBy, sortOrder) -> runSearch(q, sortBy, sortOrder, offset = 0) }
        }
    }

    /** Fetch whole-library facets so the filter sheets have options before/without a query. */
    fun ensureBaseFacets() {
        if (control.value.baseFacets != null) return
        viewModelScope.launch {
            runCatching { searchRepository.facets("") }
                .onSuccess { f -> control.update { it.copy(baseFacets = f) } }
        }
    }

    private suspend fun runSearch(q: String, sortBy: SortBy, sortOrder: SortOrder, offset: Int) {
        if (q.isBlank()) {
            control.update { it.copy(results = emptyList(), total = 0, facets = null, resultsQuery = "", isLoading = false, error = null, offset = 0) }
            return
        }
        control.update { it.copy(isLoading = offset == 0, error = null) }
        runCatching {
            searchRepository.search(q, PAGE_SIZE, offset, sortBy.wire, sortOrder.wire, includeFacets = offset == 0)
        }.onSuccess { response ->
            // A load-more that resolves after the query moved on would append rows from the old query;
            // drop it — the fresh offset-0 search now owns the state.
            if (offset > 0 && q != query.value) return@onSuccess
            control.update {
                // distinctBy protects the lazy-list item keys: concurrent load-mores or reshuffled
                // relevance-sorted offset windows can repeat a row, and duplicate keys crash Compose.
                val merged = if (offset == 0) response.results else it.results + response.results
                it.copy(
                    results = merged.distinctBy { it.dedupeKey },
                    total = response.total,
                    facets = if (offset == 0) response.facets ?: it.facets else it.facets,
                    resultsQuery = q,
                    offset = offset + response.results.size,
                    isLoading = false,
                    error = null,
                )
            }
            if (offset == 0) searchRepository.recordSearch(q)
        }.onFailure { t ->
            control.update {
                it.copy(resultsQuery = q, isLoading = false, error = if (connectivity.currentlyOnline()) messageFor(t) else null)
            }
        }
    }

    fun setFreeText(text: String) {
        query.value = setFreeText(query.value, text)
    }

    fun setQuery(raw: String) {
        query.value = raw
    }

    fun toggleFilter(key: FilterKey, value: String) {
        val current = query.value
        query.value = if (getFilterTokens(tokenizeQuery(current), key).any { it.value.equals(value, ignoreCase = true) }) {
            removeFilter(current, key, value)
        } else {
            addFilter(current, key, value)
        }
    }

    fun replaceFilter(key: FilterKey, value: String?) {
        query.value = if (value == null) removeFilter(query.value, key) else replaceFilter(query.value, key, value)
    }

    fun clearFilters() {
        query.value = getFreeText(tokenizeQuery(query.value))
    }

    fun currentHasTextMode(): HasTextMode {
        val hasTokens = getFilterTokens(tokenizeQuery(query.value), FilterKey.HAS).filter { it.value.equals("text", ignoreCase = true) }
        return when {
            hasTokens.isEmpty() -> HasTextMode.ANY
            hasTokens.any { it.negated } -> HasTextMode.NONE
            else -> HasTextMode.HAS
        }
    }

    fun setHasText(mode: HasTextMode) {
        val base = removeFilter(query.value, FilterKey.HAS, "text")
        query.value = when (mode) {
            HasTextMode.ANY -> base
            HasTextMode.HAS -> addFilter(base, FilterKey.HAS, "text")
            HasTextMode.NONE -> addFilter(base, FilterKey.HAS, "text", negated = true)
        }
    }

    fun setSize(preset: String?) {
        replaceFilter(FilterKey.SIZE, preset)
    }

    fun applyRawQuery(raw: String) {
        query.value = raw
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
        if (ctrl.isLoading || ctrl.isLoadingMore || ctrl.offset >= ctrl.total) return
        // Flip the guard synchronously (loadMore is called from the main-thread scroll collector) so
        // a burst of scroll triggers can't launch overlapping fetches of the same page.
        control.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            try {
                runSearch(query.value, ctrl.sortBy, ctrl.sortOrder, ctrl.offset)
            } finally {
                control.update { it.copy(isLoadingMore = false) }
            }
        }
    }

    private fun isPhotoish(q: String): Boolean {
        val values = getFilterTokens(tokenizeQuery(q), FilterKey.TYPE).map { it.value.lowercase() } +
            getFilterTokens(tokenizeQuery(q), FilterKey.CATEGORY).map { it.value.lowercase() }
        return values.any { it in setOf("photo", "image", "screenshot", "graphic") }
    }

    private fun messageFor(throwable: Throwable): String =
        (throwable as? ReverieApiException)?.userMessage() ?: "Search failed."

    private companion object {
        const val PAGE_SIZE = 20
    }
}
