package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.components.DocumentCardSkeleton
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.rememberSkeletonVisible
import kotlinx.coroutines.flow.distinctUntilChanged

/** Everything one tab page needs besides its own documents; the pager hands the same values to all four. */
class PagerFeed(
    val state: BrowseUiState,
    val listStates: Map<BrowseTab, LazyListState>,
    val contentPadding: PaddingValues,
    val layout: FeedLayout,
    val actions: RowActions,
    val inFolder: Boolean,
    val focusedId: String?,
    val onFocusConsumed: () -> Unit,
    val onLoadMore: (BrowseTab) -> Unit,
    val onHeading: (FeedItem.Header?) -> Unit,
    val onUpload: () -> Unit,
)

/** The four tabs side by side; swiping moves between them, and each keeps its own list state. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BrowsePager(pagerState: PagerState, feed: PagerFeed, modifier: Modifier = Modifier) {
    HorizontalPager(
        state = pagerState,
        key = { BrowseTab.entries[it] },
        modifier = modifier.fillMaxSize(),
    ) { page ->
        TabPage(BrowseTab.entries[page], feed, isCurrent = page == pagerState.currentPage)
    }
}

@Composable
private fun TabPage(tab: BrowseTab, feed: PagerFeed, isCurrent: Boolean) {
    val docs = feed.state.tabs[tab] ?: TabDocuments()
    val listState = feed.listStates.getValue(tab)
    val latestFeed by rememberUpdatedState(feed)
    // Memoized per tab so a tab whose documents have not changed is skipped when only other state moves.
    val onLoadMore = remember(tab) { { latestFeed.onLoadMore(tab) } }
    val loading = docs.isLoading || (!docs.fetched && !docs.failed && feed.state.error == null)
    when {
        docs.documents.isEmpty() && loading -> LoadingGrid(feed.contentPadding)
        docs.documents.isEmpty() -> Box(Modifier.padding(top = feed.contentPadding.calculateTopPadding()).fillMaxSize()) {
            EmptyState(
                icon = Icons.Outlined.FolderOpen,
                title = emptyTitle(tab, feed.inFolder),
                description = "Tap + to upload or scan a document.",
                actionLabel = "Upload",
                onAction = feed.onUpload,
            )
        }
        else -> TabFeed(
            tab = tab,
            documents = docs.documents,
            hasMore = docs.hasMore,
            listState = listState,
            contentPadding = feed.contentPadding,
            layout = feed.layout,
            actions = feed.actions,
            // Only the open tab answers the viewer's return: the others are not what it was showing.
            focusedId = if (isCurrent) feed.focusedId else null,
            onFocusConsumed = feed.onFocusConsumed,
            onLoadMore = onLoadMore,
            onHeading = if (isCurrent) feed.onHeading else null,
        )
    }
}

private fun emptyTitle(tab: BrowseTab, inFolder: Boolean): String = when (tab) {
    BrowseTab.ALL -> if (inFolder) "This folder is empty" else "No documents yet"
    BrowseTab.PHOTOS -> "No photos yet"
    BrowseTab.VIDEOS -> "No videos yet"
    BrowseTab.FILES -> "No files yet"
}

/**
 * Keeps the pager and the ViewModel's open tab in step: a swipe that settles on a page opens that
 * tab, and a tab opened any other way (a tap, the tab restored from the last visit) scrolls the pager.
 */
@Composable
fun SyncPagerWithTab(pagerState: PagerState, tab: BrowseTab, onSettled: (BrowseTab) -> Unit) {
    val settled by rememberUpdatedState(onSettled)
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.settledPage }
            .distinctUntilChanged()
            .collect { settled(BrowseTab.entries[it]) }
    }
    LaunchedEffect(tab) {
        if (pagerState.currentPage != tab.ordinal) pagerState.animateScrollToPage(tab.ordinal)
    }
}

/** A brief placeholder while a tab's first page loads: a fixed 3-wide square grid, since real tiles need document sizes. */
@Composable
fun LoadingGrid(contentPadding: PaddingValues) {
    val visible = rememberSkeletonVisible(isLoading = true)
    if (!visible) return
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(12) { DocumentCardSkeleton() }
    }
}
