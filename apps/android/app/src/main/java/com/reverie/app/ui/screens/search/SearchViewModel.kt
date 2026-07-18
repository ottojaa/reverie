package com.reverie.app.ui.screens.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.data.api.model.SearchHit
import com.reverie.app.data.api.model.SortBy
import com.reverie.app.data.api.model.SortOrder
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.repository.SearchRepository
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
    val quickFilters: List<QuickFilter> = emptyList(),
    val sortBy: SortBy = SortBy.RELEVANCE,
    val sortOrder: SortOrder = SortOrder.DESC,
    val userViewMode: ViewMode? = null,
    val offset: Int = 0,
    val isLoading: Boolean = false,
    val error: String? = null,
)

@OptIn(FlowPreview::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository,
    private val connectivity: ConnectivityMonitor,
) : ViewModel() {

    private val query = MutableStateFlow("")
    private val control = MutableStateFlow(SearchControl())

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
            facets = ctrl.facets,
            quickFilters = ctrl.quickFilters,
            recents = recents,
            sortBy = ctrl.sortBy,
            sortOrder = ctrl.sortOrder,
            viewMode = ctrl.userViewMode ?: if (isPhotoish(q)) ViewMode.GRID else ViewMode.LIST,
            isLoading = ctrl.isLoading,
            error = ctrl.error,
            hasMore = ctrl.results.size < ctrl.total,
            isOffline = !online,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchUiState())

    init {
        viewModelScope.launch {
            val filters = searchRepository.quickFilters()
            control.update { it.copy(quickFilters = filters) }
        }
        viewModelScope.launch {
            combine(query, control.map { it.sortBy to it.sortOrder }.distinctUntilChanged()) { q, sort -> Triple(q, sort.first, sort.second) }
                .debounce(300)
                .collect { (q, sortBy, sortOrder) -> runSearch(q, sortBy, sortOrder, offset = 0) }
        }
    }

    private suspend fun runSearch(q: String, sortBy: SortBy, sortOrder: SortOrder, offset: Int) {
        if (q.isBlank()) {
            control.update { it.copy(results = emptyList(), total = 0, facets = null, isLoading = false, error = null, offset = 0) }
            return
        }
        control.update { it.copy(isLoading = offset == 0, error = null) }
        runCatching {
            searchRepository.search(q, PAGE_SIZE, offset, sortBy.wire, sortOrder.wire, includeFacets = offset == 0)
        }.onSuccess { response ->
            control.update {
                it.copy(
                    results = if (offset == 0) response.results else it.results + response.results,
                    total = response.total,
                    facets = if (offset == 0) response.facets ?: it.facets else it.facets,
                    offset = offset + response.results.size,
                    isLoading = false,
                    error = null,
                )
            }
            if (offset == 0) searchRepository.recordSearch(q)
        }.onFailure { t ->
            control.update {
                it.copy(isLoading = false, error = if (connectivity.currentlyOnline()) messageFor(t) else null)
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

    fun loadMore() {
        val ctrl = control.value
        if (ctrl.isLoading || ctrl.results.size >= ctrl.total) return
        viewModelScope.launch { runSearch(query.value, ctrl.sortBy, ctrl.sortOrder, ctrl.offset) }
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
