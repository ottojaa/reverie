package com.reverie.app.ui.screens.search

import com.reverie.app.data.api.model.SortBy
import com.reverie.app.domain.search.FilterKey
import com.reverie.app.ui.screens.manage.RowSelection

/** A filter sheet the header's pills open. */
sealed interface SearchSheet {
    data class Facet(val key: FilterKey) : SearchSheet
    data object Date : SearchSheet
    data object More : SearchSheet
}

/** What the search page's controls, rows and tiles do. */
data class SearchActions(
    val onBack: () -> Unit = {},
    val onType: (String) -> Unit = {},
    val onSubmit: () -> Unit = {},
    val onRemoveScope: () -> Unit = {},
    val onOpenSheet: (SearchSheet) -> Unit = {},
    val onClearFilters: () -> Unit = {},
    val onSort: (SortBy) -> Unit = {},
    val onViewMode: (ViewMode) -> Unit = {},
    /** Replaces the whole query: a recent search or a quick filter. */
    val onApplyQuery: (String) -> Unit = {},
    val onRemoveRecent: (String) -> Unit = {},
    val onOpenDocument: (String) -> Unit = {},
    val onOpenFolder: (String) -> Unit = {},
    val onLoadMore: () -> Unit = {},
    /** The results' part in the page's selection. */
    val selection: RowSelection = RowSelection(),
)
