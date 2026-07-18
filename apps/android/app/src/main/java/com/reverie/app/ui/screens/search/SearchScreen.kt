package com.reverie.app.ui.screens.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sort
import androidx.compose.material.icons.outlined.ViewList
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.CollectionSearchResult
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.data.api.model.SortBy
import com.reverie.app.data.api.model.SortOrder
import com.reverie.app.ui.components.CollectionResultRow
import com.reverie.app.ui.components.DateBucketHeader
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.FilterPillBar
import com.reverie.app.ui.components.PRIMARY_DIMENSIONS
import com.reverie.app.ui.components.PhotoResultTile
import com.reverie.app.ui.components.QuickFilterChips
import com.reverie.app.ui.components.SearchResultRow
import com.reverie.app.domain.search.FilterKey
import com.reverie.app.util.dateBucket
import kotlinx.coroutines.flow.distinctUntilChanged

private sealed interface OpenSheet {
    data class Facet(val key: FilterKey) : OpenSheet
    data object Date : OpenSheet
    data object More : OpenSheet
}

@Composable
fun SearchScreen(
    onDocumentClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    onOpenFolder: (String) -> Unit = {},
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var openSheet by remember { mutableStateOf<OpenSheet?>(null) }

    val dateActive = state.activeValues(FilterKey.UPLOADED).isNotEmpty() || state.activeValues(FilterKey.DATE).isNotEmpty()
    val hasAnyActive = PRIMARY_DIMENSIONS.any { state.activeValues(it.key).isNotEmpty() } ||
        dateActive || state.activeValues(FilterKey.SIZE).isNotEmpty() || state.activeValues(FilterKey.HAS).isNotEmpty()

    Column(modifier = modifier.fillMaxSize()) {
        SearchField(
            value = state.freeText,
            onValueChange = viewModel::setFreeText,
        )

        FilterPillBar(
            activeValues = state::activeValues,
            dateActive = dateActive,
            hasAnyActive = hasAnyActive,
            onOpenDimension = { openSheet = OpenSheet.Facet(it) },
            onOpenDate = { openSheet = OpenSheet.Date },
            onOpenMore = { openSheet = OpenSheet.More },
            onClearAll = viewModel::clearFilters,
            modifier = Modifier.padding(vertical = 8.dp),
        )

        if (state.hasQuery) {
            MetaRow(
                total = state.total,
                sortBy = state.sortBy,
                sortOrder = state.sortOrder,
                viewMode = state.viewMode,
                onSort = viewModel::setSort,
                onViewMode = viewModel::setViewMode,
            )
        }

        Box(Modifier.fillMaxSize()) {
            when {
                state.isOffline && !state.hasQuery ->
                    EmptyState(icon = Icons.Outlined.WifiOff, title = "Search needs a connection", description = "Reconnect to search your library.")
                !state.hasQuery -> IdleState(
                    quickFilters = state.quickFilters,
                    recents = state.recents,
                    onApplyFilter = { viewModel.applyRawQuery(it.query) },
                    onApplyRecent = { viewModel.setFreeText(it) },
                    onRemoveRecent = viewModel::removeRecent,
                )
                state.error != null && state.results.isEmpty() ->
                    EmptyState(icon = Icons.Outlined.Search, title = "Search failed", description = state.error)
                state.results.isEmpty() && !state.isLoading ->
                    EmptyState(icon = Icons.Outlined.Search, title = "No results", description = "Try different keywords or clear some filters.")
                state.viewMode == ViewMode.GRID -> ResultsGrid(state, onDocumentClick, viewModel::loadMore)
                else -> ResultsList(state, onDocumentClick, onOpenFolder, viewModel::loadMore)
            }
        }
    }

    when (val sheet = openSheet) {
        is OpenSheet.Facet -> FacetListSheet(
            title = PRIMARY_DIMENSIONS.first { it.key == sheet.key }.label,
            options = facetOptions(state.facets, sheet.key),
            activeValues = state.activeValues(sheet.key),
            onToggle = { viewModel.toggleFilter(sheet.key, it) },
            onDismiss = { openSheet = null },
        )
        OpenSheet.Date -> DateFilterSheet(
            uploadedValue = state.activeValues(FilterKey.UPLOADED).firstOrNull(),
            dateValue = state.activeValues(FilterKey.DATE).firstOrNull(),
            onSet = { key, value -> viewModel.replaceFilter(key, value) },
            onDismiss = { openSheet = null },
        )
        OpenSheet.More -> MoreFiltersSheet(
            hasTextMode = viewModel.currentHasTextMode(),
            sizeValue = state.activeValues(FilterKey.SIZE).firstOrNull(),
            onSetHasText = viewModel::setHasText,
            onSetSize = viewModel::setSize,
            onDismiss = { openSheet = null },
        )
        null -> Unit
    }
}

@Composable
private fun SearchField(value: String, onValueChange: (String) -> Unit) {
    TextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text("Search your documents") },
        singleLine = true,
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                IconButton(onClick = { onValueChange("") }) { Icon(Icons.Outlined.Clear, contentDescription = "Clear") }
            }
        },
        shape = RoundedCornerShape(16.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
            unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun MetaRow(
    total: Int,
    sortBy: SortBy,
    sortOrder: SortOrder,
    viewMode: ViewMode,
    onSort: (SortBy) -> Unit,
    onViewMode: (ViewMode) -> Unit,
) {
    var sortMenu by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("$total ${if (total == 1) "result" else "results"}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Box {
            TextButton(onClick = { sortMenu = true }) {
                Icon(Icons.Outlined.Sort, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  ${sortLabel(sortBy)}")
            }
            DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                listOf(SortBy.RELEVANCE, SortBy.UPLOADED, SortBy.DATE, SortBy.FILENAME, SortBy.SIZE).forEach { option ->
                    DropdownMenuItem(
                        text = { Text(sortLabel(option) + if (option == sortBy) (if (sortOrder == SortOrder.DESC) "  ↓" else "  ↑") else "") },
                        onClick = { sortMenu = false; onSort(option) },
                    )
                }
            }
        }
        IconButton(onClick = { onViewMode(if (viewMode == ViewMode.GRID) ViewMode.LIST else ViewMode.GRID) }) {
            Icon(
                if (viewMode == ViewMode.GRID) Icons.Outlined.ViewList else Icons.Outlined.GridView,
                contentDescription = "Toggle view",
            )
        }
    }
}

@Composable
private fun ResultsList(
    state: SearchUiState,
    onDocumentClick: (String) -> Unit,
    onOpenFolder: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    val listState = rememberLazyListState()
    androidx.compose.runtime.LaunchedEffect(listState, state.results.size, state.hasMore) {
        androidx.compose.runtime.snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .collect { last -> if (state.hasMore && last >= state.results.size - 4) onLoadMore() }
    }
    val showBuckets = state.sortBy == SortBy.UPLOADED || state.sortBy == SortBy.DATE

    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        var lastBucket: String? = null
        state.results.forEach { hit ->
            when (hit) {
                is DocumentSearchResult -> {
                    if (showBuckets) {
                        val bucket = dateBucket(hit.extracted_date ?: hit.uploaded_at)
                        if (bucket != lastBucket) {
                            lastBucket = bucket
                            item(key = "bucket-$bucket") { DateBucketHeader(bucket) }
                        }
                    }
                    item(key = hit.document_id) { SearchResultRow(hit = hit, onClick = { onDocumentClick(hit.document_id) }) }
                }
                is CollectionSearchResult -> item(key = "col-${hit.id}") {
                    CollectionResultRow(hit = hit, onClick = { onOpenFolder(hit.id) })
                }
            }
        }
    }
}

@Composable
private fun ResultsGrid(state: SearchUiState, onDocumentClick: (String) -> Unit, onLoadMore: () -> Unit) {
    val gridState = rememberLazyGridState()
    androidx.compose.runtime.LaunchedEffect(gridState, state.results.size, state.hasMore) {
        androidx.compose.runtime.snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .collect { last -> if (state.hasMore && last >= state.results.size - 4) onLoadMore() }
    }
    val documents = state.results.filterIsInstance<DocumentSearchResult>()

    LazyVerticalGrid(
        state = gridState,
        columns = GridCells.Adaptive(110.dp),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(documents, key = { it.document_id }) { hit ->
            PhotoResultTile(hit = hit, onClick = { onDocumentClick(hit.document_id) })
        }
    }
}

@Composable
private fun IdleState(
    quickFilters: List<com.reverie.app.data.api.model.QuickFilter>,
    recents: List<String>,
    onApplyFilter: (com.reverie.app.data.api.model.QuickFilter) -> Unit,
    onApplyRecent: (String) -> Unit,
    onRemoveRecent: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (quickFilters.isNotEmpty()) {
            Text("Quick filters", style = MaterialTheme.typography.titleSmall)
            QuickFilterChips(filters = quickFilters, onSelect = onApplyFilter)
        }
        if (recents.isNotEmpty()) {
            Text("Recent searches", style = MaterialTheme.typography.titleSmall)
            recents.forEach { recent ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = { onApplyRecent(recent) }, modifier = Modifier.weight(1f)) {
                        Text(recent, modifier = Modifier.fillMaxWidth())
                    }
                    IconButton(onClick = { onRemoveRecent(recent) }) { Icon(Icons.Outlined.Clear, contentDescription = "Remove", modifier = Modifier.size(18.dp)) }
                }
            }
        }
    }
}

private fun facetOptions(facets: SearchFacets?, key: FilterKey) = when (key) {
    FilterKey.TYPE -> facets?.types
    FilterKey.CATEGORY -> facets?.categories
    FilterKey.FOLDER -> facets?.folders
    FilterKey.TAG -> facets?.tags
    else -> null
}.orEmpty()

private fun sortLabel(sortBy: SortBy): String = when (sortBy) {
    SortBy.RELEVANCE -> "Relevance"
    SortBy.UPLOADED -> "Uploaded"
    SortBy.DATE -> "Date"
    SortBy.FILENAME -> "Name"
    SortBy.SIZE -> "Size"
}
