package com.reverie.app.ui.screens.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.CollectionSearchResult
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.SortBy
import com.reverie.app.domain.CachedFolders
import com.reverie.app.domain.folderMeta
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.components.DateBucketHeader
import com.reverie.app.ui.components.FolderRow
import com.reverie.app.ui.components.PhotoResultTile
import com.reverie.app.ui.components.QuickFilterChips
import com.reverie.app.ui.components.SearchResultRow
import com.reverie.app.ui.navigation.navigationBarInset
import com.reverie.app.util.dateBucket
import kotlinx.coroutines.flow.distinctUntilChanged

private const val WHOLE_LIBRARY_KEY = "whole-library"

/** How the offer to widen a scoped search reads. */
internal fun wholeLibraryLabel(offer: String): String = "Search “$offer” in the whole library"

@Composable
internal fun ResultsList(state: SearchUiState, actions: SearchActions, listState: LazyListState, topInset: Dp) {
    LoadMoreNearEnd(state.results.size, state.hasMore, actions.onLoadMore) {
        listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
    }
    val showBuckets = state.sortBy == SortBy.UPLOADED || state.sortBy == SortBy.DATE

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = topInset, bottom = navigationBarInset()),
    ) {
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
                    item(key = hit.document_id) {
                        SearchResultRow(hit = hit, onClick = { actions.onOpenDocument(hit.document_id) })
                    }
                }
                is CollectionSearchResult -> item(key = "col-${hit.id}") {
                    FolderHitRow(hit, state.folders, onClick = { actions.onOpenFolder(hit.id) })
                }
            }
        }
        val offer = state.wholeLibraryOffer
        if (offer != null && state.results.isNotEmpty() && !state.hasMore) {
            item(key = WHOLE_LIBRARY_KEY) { WholeLibraryRow(offer, actions.onRemoveScope) }
        }
    }
}

@Composable
internal fun ResultsGrid(state: SearchUiState, actions: SearchActions, gridState: LazyGridState, topInset: Dp) {
    // The grid renders documents only, so paging compares against the document count: the results also
    // count folder hits, which would under-trigger and stall it.
    val documents = state.results.filterIsInstance<DocumentSearchResult>()
    LoadMoreNearEnd(documents.size, state.hasMore, actions.onLoadMore) {
        gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
    }

    LazyVerticalGrid(
        state = gridState,
        columns = GridCells.Adaptive(minSize = 116.dp),
        contentPadding = PaddingValues(top = topInset + 4.dp, bottom = 12.dp + navigationBarInset()),
        verticalArrangement = Arrangement.spacedBy(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(documents, key = { it.document_id }) { hit ->
            PhotoResultTile(hit = hit, onClick = { actions.onOpenDocument(hit.document_id) })
        }
        val offer = state.wholeLibraryOffer
        if (offer != null && documents.isNotEmpty() && !state.hasMore) {
            item(key = WHOLE_LIBRARY_KEY, span = { GridItemSpan(maxLineSpan) }) {
                WholeLibraryRow(offer, actions.onRemoveScope)
            }
        }
    }
}

@Composable
private fun LoadMoreNearEnd(count: Int, hasMore: Boolean, onLoadMore: () -> Unit, lastVisible: () -> Int) {
    LaunchedEffect(count, hasMore) {
        snapshotFlow(lastVisible)
            .distinctUntilChanged()
            .collect { last -> if (hasMore && last >= count - 4) onLoadMore() }
    }
}

/** A folder among the results, drawn like its row anywhere else when the folder is cached. */
@Composable
private fun FolderHitRow(hit: CollectionSearchResult, folders: CachedFolders, onClick: () -> Unit) {
    val cached = folders.byId[hit.id]
    FolderRow(
        folder = cached ?: hit.toFolder(),
        cover = folders.covers[hit.id],
        meta = cached?.let(::folderMeta) ?: hit.path.trim('/'),
        onClick = onClick,
    )
}

private fun CollectionSearchResult.toFolder() = FolderWithChildren(
    id = id, name = name, path = path, sort_order = 0, is_private = false, created_at = "", updated_at = "",
)

@Composable
private fun WholeLibraryRow(offer: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 18.dp),
    ) {
        Row(
            modifier = Modifier.heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val quiet = MaterialTheme.colorScheme.onSurfaceVariant
            Icon(Icons.Outlined.Search, contentDescription = null, tint = quiet, modifier = Modifier.size(20.dp))
            Text(
                wholeLibraryLabel(offer),
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = quiet)
        }
    }
}

/** Before there is a query: ready-made filters (their counts are library-wide) and recent searches. */
@Composable
internal fun IdleState(state: SearchUiState, actions: SearchActions, topInset: Dp) {
    val quickFilters = state.quickFilters.takeIf { state.scope == SearchScope.Library }.orEmpty()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = topInset + 16.dp, bottom = 16.dp + navigationBarInset()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (quickFilters.isNotEmpty()) {
            Text("Quick filters", style = MaterialTheme.typography.titleSmall)
            QuickFilterChips(filters = quickFilters, onSelect = { actions.onApplyQuery(it.query) })
        }
        if (state.recents.isEmpty()) return@Column
        Text("Recent searches", style = MaterialTheme.typography.titleSmall)
        state.recents.forEach { recent -> RecentSearch(recent, actions) }
    }
}

@Composable
private fun RecentSearch(recent: String, actions: SearchActions) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        TextButton(onClick = { actions.onApplyQuery(recent) }, modifier = Modifier.weight(1f)) {
            Text(recent, modifier = Modifier.fillMaxWidth())
        }
        IconButton(onClick = { actions.onRemoveRecent(recent) }) {
            Icon(Icons.Outlined.Clear, contentDescription = "Remove", modifier = Modifier.size(18.dp))
        }
    }
}
