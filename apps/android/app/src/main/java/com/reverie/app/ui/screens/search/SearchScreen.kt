package com.reverie.app.ui.screens.search

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.domain.search.FilterKey
import com.reverie.app.ui.components.PRIMARY_DIMENSIONS
import com.reverie.app.ui.screens.viewer.returnedDocumentId

@Composable
fun SearchScreen(
    onBack: () -> Unit,
    onDocumentClick: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var openSheet by remember { mutableStateOf<SearchSheet?>(null) }
    val scroll = rememberSearchScroll()
    ReturnToViewedResult(viewModel, state, scroll)
    SearchBody(
        state = state,
        modifier = modifier,
        scroll = scroll,
        actions = SearchActions(
            onBack = onBack,
            onType = viewModel::setFreeText,
            onSubmit = viewModel::rememberSubmitted,
            onRemoveScope = viewModel::removeScope,
            onOpenSheet = { sheet ->
                openSheet = sheet
                if (sheet is SearchSheet.Facet) viewModel.ensureBaseFacets()
            },
            onClearFilters = viewModel::clearFilters,
            onSort = viewModel::setSort,
            onViewMode = viewModel::setViewMode,
            onApplyQuery = viewModel::setQuery,
            onRemoveRecent = viewModel::removeRecent,
            // Publish the result order so the viewer can swipe between hits, then open the tapped one.
            onOpenDocument = { id -> viewModel.rememberOpened(); viewModel.prepareSequence(); onDocumentClick(id) },
            onOpenFolder = { id -> viewModel.rememberOpened(); onOpenFolder(id) },
            onLoadMore = viewModel::loadMore,
        ),
    )
    openSheet?.let { FilterSheet(it, state, viewModel, onDismiss = { openSheet = null }) }
}

/**
 * When the viewer swiped to another result, scrolls the grid so that tile is laid out, so popping back
 * lands the shared-element transform on it (else a plain fade).
 */
@Composable
private fun ReturnToViewedResult(viewModel: SearchViewModel, state: SearchUiState, scroll: SearchScroll) {
    val focusedId = returnedDocumentId(viewModel.viewerFocus)
    LaunchedEffect(focusedId, state.results) {
        val id = focusedId ?: return@LaunchedEffect
        if (state.viewMode != ViewMode.GRID) return@LaunchedEffect
        val index = state.results.filterIsInstance<DocumentSearchResult>().indexOfFirst { it.document_id == id }
        if (index < 0) return@LaunchedEffect
        if (scroll.grid.layoutInfo.visibleItemsInfo.none { it.index == index }) scroll.grid.scrollToItem(index)
        // Consume it so later result updates (e.g. a thumbnail-complete refetch) don't re-scroll here.
        viewModel.clearViewerFocus()
    }
}

@Composable
private fun FilterSheet(sheet: SearchSheet, state: SearchUiState, viewModel: SearchViewModel, onDismiss: () -> Unit) {
    when (sheet) {
        is SearchSheet.Facet -> FacetListSheet(
            title = PRIMARY_DIMENSIONS.first { it.key == sheet.key }.label,
            options = facetOptions(state.facets, sheet.key),
            activeValues = state.activeValues(sheet.key),
            onToggle = { viewModel.toggleFilter(sheet.key, it) },
            onDismiss = onDismiss,
        )
        SearchSheet.Date -> DateFilterSheet(
            uploadedValue = state.activeValues(FilterKey.UPLOADED).firstOrNull(),
            dateValue = state.activeValues(FilterKey.DATE).firstOrNull(),
            onSet = { key, value -> viewModel.replaceFilter(key, value) },
            onDismiss = onDismiss,
        )
        SearchSheet.More -> MoreFiltersSheet(
            hasTextMode = viewModel.currentHasTextMode(),
            sizeValue = state.activeValues(FilterKey.SIZE).firstOrNull(),
            onSetHasText = viewModel::setHasText,
            onSetSize = viewModel::setSize,
            onDismiss = onDismiss,
        )
    }
}

private fun facetOptions(facets: SearchFacets?, key: FilterKey) = when (key) {
    FilterKey.TYPE -> facets?.types
    FilterKey.CATEGORY -> facets?.categories
    FilterKey.FOLDER -> facets?.folders
    FilterKey.TAG -> facets?.tags
    else -> null
}.orEmpty()
