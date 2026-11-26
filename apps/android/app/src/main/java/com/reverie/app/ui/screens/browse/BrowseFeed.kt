package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.settings.GridLayoutMode
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.distinctUntilChangedBy
import java.time.LocalDate
import java.time.ZoneId

/** What the feed needs to turn documents into rows: the user's grid setting and the calendar it groups by. */
data class FeedLayout(
    val mode: GridLayoutMode,
    val featureEvery: Int,
    val today: LocalDate,
    val zone: ZoneId,
)

/**
 * A [FeedSource]'s scrolling list: the source only changes which rows [feedRows] produces. [focusedId] is
 * the document the viewer last showed; [expanded] holds the keys of a folded list's opened groups;
 * [onTopDate] reports the date of what is under the top edge, for the floating date chip.
 */
@Composable
fun FeedList(
    source: FeedSource,
    documents: List<DocumentDto>,
    hasMore: Boolean,
    listState: LazyListState,
    contentPadding: PaddingValues,
    layout: FeedLayout,
    actions: RowActions,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
    expanded: Set<String> = emptySet(),
    onTopDate: (TopDate?) -> Unit = {},
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val width = maxWidth.value
        val rows = remember(source, documents, expanded, width, layout) {
            feedRows(source, documents, expanded, width, layout)
        }
        FeedScrollEffects(rows, listState, hasMore, onLoadMore, focusedId, onFocusConsumed)
        TopDateEffect(rows, listState, layout, onTopDate)
        LazyColumn(state = listState, contentPadding = contentPadding, modifier = Modifier.fillMaxSize()) {
            items(rows.size, key = { rows[it].key }, contentType = { rows[it].contentType }) { index ->
                FeedRowView(rows[index], actions, layout.today, layout.zone)
            }
        }
    }
}

/**
 * What a document list does as it scrolls: ask for the next page near the end, and scroll the viewer's last
 * document into view on return.
 *
 * @param leading how many items of the lazy list come before the first of [rows].
 */
@Composable
internal fun FeedScrollEffects(
    rows: List<FeedRow>,
    listState: LazyListState,
    hasMore: Boolean,
    onLoadMore: () -> Unit,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    leading: Int = 0,
) {
    val loadMore by rememberUpdatedState(onLoadMore)
    // Keyed on the documents too: a page that only extends a folded group adds no row, and a list that does
    // not fill the screen must keep asking until it does.
    val loaded = rows.sumOf { it.docIds.size }
    LaunchedEffect(listState, leading, rows.size, loaded, hasMore) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
            .distinctUntilChanged()
            .collect { last -> if (isNearEnd(last - leading, rows.size, hasMore)) loadMore() }
    }

    // Scroll only when the document's row is off screen, and consume the signal so a later list
    // update (a thumbnail finishing) doesn't scroll again. A document this list hasn't loaded keeps
    // the signal until its page arrives.
    LaunchedEffect(focusedId, leading, rows) {
        val id = focusedId ?: return@LaunchedEffect
        val row = rowIndexOf(rows, id)
        if (row < 0) return@LaunchedEffect
        val index = leading + row
        if (listState.layoutInfo.visibleItemsInfo.none { it.index == index }) listState.scrollToItem(index)
        onFocusConsumed()
    }
}

/**
 * Tells the date chip what is at the top of the list, each time that changes: not on every row crossed. A list that
 * leaves the screen takes its date with it.
 *
 * @param leading how many items of the lazy list come before the first of [rows].
 */
@Composable
internal fun TopDateEffect(
    rows: List<FeedRow>,
    listState: LazyListState,
    layout: FeedLayout,
    onTopDate: (TopDate?) -> Unit,
    leading: Int = 0,
) {
    val report by rememberUpdatedState(onTopDate)
    LaunchedEffect(listState, rows, leading, layout) {
        snapshotFlow { topDateAt(rows, listState.firstVisibleItemIndex - leading, layout.today, layout.zone) }
            .distinctUntilChangedBy { it?.title to it?.isOverPhotos }
            .collect { report(it) }
    }
    DisposableEffect(Unit) { onDispose { report(null) } }
}
