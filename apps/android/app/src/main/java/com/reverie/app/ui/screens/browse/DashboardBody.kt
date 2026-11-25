package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.ui.screens.favourites.FavouritesStrip
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import java.time.LocalDate
import java.time.ZoneId

/** What the dashboard's cards and rows do when tapped. */
class DashboardActions(
    val onOpenKind: (DocumentKind) -> Unit,
    val recent: RecentActions,
    val onOpenFavourite: (FavouriteDto) -> Unit = {},
    val onSeeAllFavourites: () -> Unit = {},
)

/** List items ahead of Recently added's first entry: the cards (under the favourites strip), then the heading. */
private const val LEAD_ITEMS = 2

/**
 * The dashboard's body: the favourites strip, the picture cards, then Recently added.
 * Stateless: the screen hands it the state and what to do, so the same body is drawn in a screenshot or a
 * navigation test.
 */
@Composable
fun DashboardBody(
    state: DashboardState,
    listState: LazyListState,
    contentPadding: PaddingValues,
    today: LocalDate,
    zone: ZoneId,
    actions: DashboardActions,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    onLoadMore: () -> Unit,
    error: String?,
    onUpload: () -> Unit,
    modifier: Modifier = Modifier,
    favourites: List<FavouriteDto> = emptyList(),
) {
    val recent = state.recent.documents
    if (isFirstLoad(recent, error) && state.cards.isEmpty()) {
        LoadingGrid(contentPadding)
        return
    }
    if (recent.fetched && recent.documents.isEmpty()) {
        Column(modifier.fillMaxSize()) {
            Strip(favourites, actions)
            EmptyList(emptyTitle(null), contentPadding, onUpload)
        }
        return
    }
    val entries = state.entries
    DashboardEffects(listState, entries, recent.documents.size, recent.hasMore, focusedId, onFocusConsumed, onLoadMore)
    LazyColumn(state = listState, contentPadding = contentPadding, modifier = modifier.fillMaxSize()) {
        // The strip shares the cards' item: it arrives after the list does, and an item of its own, inserted
        // above the one the list is anchored to, would stay scrolled out of sight.
        item(key = "cards", contentType = "cards") {
            Column {
                Strip(favourites, actions)
                KindCards(state.cards, state.photoPreview, state.videoPreview, actions.onOpenKind)
            }
        }
        item(key = "heading", contentType = "heading") {
            Text(
                "Recently added",
                fontSize = 18.sp,
                lineHeight = 24.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 4.dp),
            )
        }
        items(entries.size, key = { entries[it].listKey() }, contentType = { entries[it]::class }) { index ->
            RecentEntryView(entries[index], actions.recent, today, zone)
        }
    }
}

@Composable
private fun Strip(favourites: List<FavouriteDto>, actions: DashboardActions) {
    if (favourites.isEmpty()) return
    FavouritesStrip(favourites, actions.onOpenFavourite, actions.onSeeAllFavourites, Modifier.padding(bottom = 20.dp))
}

private fun RecentEntry.listKey(): String = if (this is RecentEntry.Row) "row:$key" else key

/**
 * Two things the list does on its own: ask for the next page, and scroll the viewer's last document into view.
 * Paging re-checks after every page (keyed on the loaded documents, not the rows: a page that only extends a
 * fold adds no row), so a short list that doesn't fill the screen keeps asking until it does.
 */
@Composable
private fun DashboardEffects(
    listState: LazyListState,
    entries: List<RecentEntry>,
    loadedCount: Int,
    hasMore: Boolean,
    focusedId: String?,
    onFocusConsumed: () -> Unit,
    onLoadMore: () -> Unit,
) {
    val loadMore by rememberUpdatedState(onLoadMore)
    LaunchedEffect(listState, loadedCount, hasMore) {
        if (!hasMore) return@LaunchedEffect
        snapshotFlow {
            val info = listState.layoutInfo
            isNearEnd(info.visibleItemsInfo.lastOrNull()?.index ?: -1, info.totalItemsCount, hasMore)
        }
            .distinctUntilChanged()
            .filter { it }
            .collect { loadMore() }
    }

    // A document inside a fold or stack scrolls to its row (or its member, when that is open); nothing expands.
    LaunchedEffect(focusedId, entries) {
        val id = focusedId ?: return@LaunchedEffect
        val index = entryIndexOf(entries, id)
        if (index < 0) return@LaunchedEffect
        val at = index + LEAD_ITEMS
        if (listState.layoutInfo.visibleItemsInfo.none { it.index == at }) listState.scrollToItem(at)
        onFocusConsumed()
    }
}

/** The index of the entry that draws [docId]: its open member, else the row it is in; -1 when it isn't loaded. */
fun entryIndexOf(entries: List<RecentEntry>, docId: String): Int {
    val member = entries.indexOfFirst { it is RecentEntry.Member && it.doc.id == docId }
    if (member >= 0) return member
    return entries.indexOfFirst { it is RecentEntry.Row && docId in it.row.docIds() }
}
