package com.reverie.app.ui.screens.search

import com.reverie.app.data.api.model.CollectionSearchResult
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.data.api.model.SearchHit
import com.reverie.app.data.api.model.SortBy
import com.reverie.app.data.api.model.SortOrder
import com.reverie.app.domain.CachedFolders
import com.reverie.app.domain.search.FilterKey
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.domain.search.getFilterTokens
import com.reverie.app.domain.search.getFreeText
import com.reverie.app.domain.search.tokenizeQuery

enum class ViewMode { LIST, GRID }

enum class HasTextMode { ANY, HAS, NONE }

/** One search as it is sent: a query looked for in a scope. */
data class SearchAsk(val query: String = "", val scope: SearchScope = SearchScope.Library)

/**
 * What to search for, and what the search field last held. The query is rebuilt from its tokens, which loses
 * a space being typed, so the field's own text is kept beside it.
 */
internal data class SearchInput(val ask: SearchAsk, val typed: String = ask.query) {
    /** The field's text: as typed, unless the query now says something else. */
    val freeText: String
        get() {
            val said = getFreeText(tokenizeQuery(ask.query))
            return if (typed.words() == said.words()) typed else said
        }

    private fun String.words(): List<String> = split(Regex("\\s+")).filter { it.isNotEmpty() }
}

data class SearchUiState(
    val query: String = "",
    val freeText: String = "",
    val scope: SearchScope = SearchScope.Library,
    val folders: CachedFolders = CachedFolders(),
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

    private val scopeFolderName: String? get() = scope.folderId?.let { folders.byId[it]?.name }

    /** What the empty search field says it searches. */
    val placeholder: String
        get() = when (scope) {
            SearchScope.Library -> "Search your library"
            SearchScope.Media -> "Search photos and videos"
            is SearchScope.Folder -> "Search ${scopeFolderName ?: "this folder"}"
        }

    /** What the removable scope chip says; null when the whole library is searched. */
    val scopeLabel: String?
        get() = when (scope) {
            SearchScope.Library -> null
            SearchScope.Media -> "Photos and videos"
            is SearchScope.Folder -> "In ${scopeFolderName ?: "this folder"}"
        }

    /** What to offer to look for in the whole library: the words typed, or the whole query when it is all filters. */
    val wholeLibraryOffer: String?
        get() = freeText.trim().ifEmpty { query }.takeIf { hasQuery && scope != SearchScope.Library }
}

/**
 * The page before anything has loaded. It already names the scope: a scope chip added a frame later would
 * land scrolled out of sight, ahead of the filter pills the row had settled on.
 */
internal fun openingState(input: SearchInput) = SearchUiState(
    query = input.ask.query,
    freeText = input.freeText,
    scope = input.ask.scope,
    isSearching = input.ask.query.isNotBlank(),
)

internal data class SearchControl(
    val results: List<SearchHit> = emptyList(),
    val total: Int = 0,
    val facets: SearchFacets? = null,
    // The facets of everything in a scope, fetched once, so the filter sheets have options before a query.
    val baseFacets: Map<SearchScope, SearchFacets> = emptyMap(),
    // The search the current [results] answer; lets the UI tell "typing, results are stale" apart
    // from "searched, genuinely empty" so it never flashes "No results" during the debounce.
    val answered: SearchAsk? = null,
    // The query the [results] on show came from. Unlike [answered], a search that failed leaves it be.
    val resultsQuery: String = "",
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
internal val SearchHit.dedupeKey: String
    get() = when (this) {
        is DocumentSearchResult -> "doc:$document_id"
        is CollectionSearchResult -> "col:$id"
    }

/** Photos make better sense as a grid: a search narrowed to them, by its scope or its filters. */
internal fun defaultViewMode(ask: SearchAsk, folders: CachedFolders): ViewMode {
    val tokens = tokenizeQuery(ask.query)
    val filtered = getFilterTokens(tokens, FilterKey.TYPE) + getFilterTokens(tokens, FilterKey.CATEGORY)
    if (filtered.any { it.value.lowercase() in PHOTO_VALUES }) return ViewMode.GRID
    if (ask.scope.isMediaOnly) return ViewMode.GRID
    val held = ask.scope.folderId?.let { folders.byId[it]?.kind_counts } ?: return ViewMode.LIST
    return if (held.file == 0 && held.total > 0) ViewMode.GRID else ViewMode.LIST
}

private val PHOTO_VALUES = setOf("photo", "image", "screenshot", "graphic")
