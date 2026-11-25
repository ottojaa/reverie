package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.unit.dp
import com.reverie.app.data.settings.FolderViewMode
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import java.time.LocalDate
import java.time.ZoneId

private const val GRID_COLUMNS = 3

/**
 * A folder page's body: the selected chip's documents as tiles or rows, newest first, or its skeleton or
 * empty state. Each chip keeps its own scroll position. Stateless: the screen hands it the state and what to
 * do, so the same body is drawn in a screenshot or a navigation test.
 *
 * @param viewMode null while the saved choice is being read.
 */
@Composable
fun FolderBody(
    state: FolderState,
    viewMode: FolderViewMode?,
    actions: RowActions,
    today: LocalDate,
    zone: ZoneId,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    onLoadMore: () -> Unit,
    error: String?,
    slot: ChromeSlot,
) {
    // Ahead of the early returns, so a chip's position survives another chip's skeleton.
    val scrollPositions = rememberSaveableStateHolder()
    val documents = state.feed.documents
    if (viewMode == null || isFirstLoad(documents, error)) {
        LoadingGrid(slot.contentPadding)
        return
    }
    if (documents.fetched && documents.documents.isEmpty()) {
        EmptyList(emptyTitle(state.selected), slot.contentPadding, slot.onUpload)
        return
    }
    scrollPositions.SaveableStateProvider(state.selected?.name ?: "ALL") {
        val gridState = rememberLazyGridState()
        val isGrid = viewMode == FolderViewMode.GRID
        val columns = if (isGrid) GRID_COLUMNS else 1
        val docs = documents.documents
        ShowArrivalsAtTop(gridState, docs.firstOrNull()?.id)
        LoadNearEnd(gridState, columns, docs.size, documents.hasMore, onLoadMore)
        LaunchedEffect(focusedId, docs) {
            // The viewer's last document: scrolled to once it is loaded, and only if it is off screen.
            val index = docs.indexOfFirst { it.id == focusedId }
            if (index < 0) return@LaunchedEffect
            if (gridState.layoutInfo.visibleItemsInfo.none { it.index == index }) gridState.scrollToItem(index)
            onFocusConsumed()
        }
        val side = if (isGrid) 20.dp else 0.dp
        LazyVerticalGrid(
            columns = GridCells.Fixed(columns),
            state = gridState,
            contentPadding = PaddingValues(
                start = side,
                end = side,
                top = if (isGrid) 8.dp else 0.dp,
                bottom = slot.contentPadding.calculateBottomPadding(),
            ),
            verticalArrangement = Arrangement.spacedBy(if (isGrid) 12.dp else 0.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = slot.modifier.fillMaxSize(),
        ) {
            items(docs, key = { it.id }, contentType = { isGrid }) { doc ->
                if (isGrid) {
                    FolderTile(doc, actions)
                } else {
                    FolderRow(doc, folderRowMeta(doc, state.selected, today, zone), actions)
                }
            }
        }
    }
}

/**
 * A lazy grid stays on the item it was showing, so a document added above the first one (an upload) would
 * arrive off screen. A grid that is at its top stays at its top instead.
 */
@Composable
private fun ShowArrivalsAtTop(gridState: LazyGridState, firstId: String?) {
    remember(firstId) {
        Snapshot.withoutReadObservation {
            val atTop = gridState.firstVisibleItemIndex == 0 && gridState.firstVisibleItemScrollOffset == 0
            if (atTop) gridState.requestScrollToItem(0)
        }
    }
}

/**
 * Asks for the next page when the end is near. Re-checked after every page (keyed on how much is loaded), so
 * a short list that doesn't fill the screen keeps asking until it does.
 */
@Composable
private fun LoadNearEnd(gridState: LazyGridState, columns: Int, loadedCount: Int, hasMore: Boolean, onLoadMore: () -> Unit) {
    val loadMore by rememberUpdatedState(onLoadMore)
    LaunchedEffect(gridState, columns, loadedCount, hasMore) {
        if (!hasMore) return@LaunchedEffect
        snapshotFlow {
            val info = gridState.layoutInfo
            val lastRow = (info.visibleItemsInfo.lastOrNull()?.index ?: -1) / columns
            isNearEnd(lastRow, (info.totalItemsCount + columns - 1) / columns, hasMore)
        }
            .distinctUntilChanged()
            .filter { it }
            .collect { loadMore() }
    }
}
