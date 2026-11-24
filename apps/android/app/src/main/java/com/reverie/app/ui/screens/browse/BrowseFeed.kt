package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.settings.GridLayoutMode
import kotlinx.coroutines.flow.distinctUntilChanged
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
 * A kind screen's scrolling list, shared by Photos, Videos and Files: the kind only changes which
 * rows [buildFeed] produces. [focusedId] is the document the viewer last showed; [onHeading] reports
 * the group under the top edge, for the floating date chip.
 */
@Composable
fun KindFeed(
    kind: DocumentKind,
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
    onHeading: ((FeedItem.Header?) -> Unit)? = null,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val width = maxWidth.value
        val rows = remember(kind, documents, width, layout) {
            toRows(buildFeed(kind, documents, layout.today, layout.zone), width, layout.mode, layout.featureEvery)
        }
        FeedScrollEffects(rows, listState, hasMore, onLoadMore, focusedId, onFocusConsumed, onHeading)
        LazyColumn(state = listState, contentPadding = contentPadding, modifier = Modifier.fillMaxSize()) {
            items(rows.size, key = { rows[it].key }, contentType = { rows[it].contentType }) { index ->
                FeedRowView(rows[index], actions)
            }
        }
    }
}

/**
 * The three things a kind screen's list does on scroll: ask for the next page near the end, scroll the
 * viewer's last document into view on return, and tell the date chip which group is at the top.
 */
@Composable
private fun FeedScrollEffects(
    rows: List<FeedRow>,
    listState: LazyListState,
    hasMore: Boolean,
    onLoadMore: () -> Unit,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    onHeading: ((FeedItem.Header?) -> Unit)?,
) {
    val loadMore by rememberUpdatedState(onLoadMore)
    LaunchedEffect(listState, rows.size, hasMore) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
            .distinctUntilChanged()
            .collect { last -> if (isNearEnd(last, rows.size, hasMore)) loadMore() }
    }

    // Scroll only when the document's row is off screen, and consume the signal so a later list
    // update (a thumbnail finishing) doesn't scroll again. A document this list hasn't loaded keeps
    // the signal until its page arrives.
    LaunchedEffect(focusedId, rows) {
        val id = focusedId ?: return@LaunchedEffect
        val index = rowIndexOf(rows, id)
        if (index < 0) return@LaunchedEffect
        if (listState.layoutInfo.visibleItemsInfo.none { it.index == index }) listState.scrollToItem(index)
        onFocusConsumed()
    }

    if (onHeading == null) return
    val report by rememberUpdatedState(onHeading)
    LaunchedEffect(listState, rows) {
        snapshotFlow { headingAt(rows, listState.firstVisibleItemIndex) }
            .distinctUntilChanged()
            .collect { report(it) }
    }
}
