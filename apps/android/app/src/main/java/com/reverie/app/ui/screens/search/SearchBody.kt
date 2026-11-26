package com.reverie.app.ui.screens.search

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import com.reverie.app.ui.components.EmptyState

/** Where the results are scrolled to, one position for each way of laying them out. */
class SearchScroll(val list: LazyListState, val grid: LazyGridState)

@Composable
fun rememberSearchScroll(): SearchScroll {
    val list = rememberLazyListState()
    val grid = rememberLazyGridState()
    return remember(list, grid) { SearchScroll(list, grid) }
}

/** The search page: the header over what the query found, or over ways to start one. */
@Composable
fun SearchBody(
    state: SearchUiState,
    actions: SearchActions,
    modifier: Modifier = Modifier,
    scroll: SearchScroll = rememberSearchScroll(),
) {
    val isHeaderShown = rememberHeaderShown(state, scroll)
    Box(modifier = modifier.fillMaxSize().statusBarsPadding()) {
        val density = LocalDensity.current
        // The header is drawn as an OVERLAY on top of the results, not stacked above them, so showing or
        // hiding it slides and fades it over the content and never reflows the grid (that reflow was a
        // scroll "jump"). Results reserve its height as top padding so the first row starts below it.
        var headerPx by remember { mutableStateOf(0) }
        val headerDp = with(density) { headerPx.toDp() }
        val headerOffset by animateFloatAsState(if (isHeaderShown) 0f else -headerPx.toFloat(), label = "chromeOffset")
        val headerAlpha by animateFloatAsState(if (isHeaderShown) 1f else 0f, label = "chromeAlpha")

        SearchContent(state, actions, scroll, headerDp)

        // Always composed at full size (animated through graphicsLayer, never removed), so its height, and
        // with it the results' top padding, is constant.
        SearchHeader(
            state = state,
            actions = actions,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .graphicsLayer { translationY = headerOffset; alpha = headerAlpha }
                .background(MaterialTheme.colorScheme.background)
                .onSizeChanged { if (it.height > 0) headerPx = it.height },
        )

        // Thin indeterminate bar pinned above the header while a search is in flight (no layout shift).
        if (state.isSearching) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter))
        }
    }
}

@Composable
private fun SearchContent(state: SearchUiState, actions: SearchActions, scroll: SearchScroll, topInset: Dp) {
    val offer = state.wholeLibraryOffer
    val belowHeader = Modifier.padding(top = topInset)
    when {
        state.isOffline && !state.hasQuery ->
            EmptyState(icon = Icons.Outlined.WifiOff, title = "Search needs a connection", description = "Reconnect to search your library.")
        !state.hasQuery -> IdleState(state, actions, topInset)
        state.error != null && state.results.isEmpty() ->
            EmptyState(icon = Icons.Outlined.Search, title = "Search failed", modifier = belowHeader, description = state.error)
        // Only "No results" once the search for the current query has actually returned —
        // during the debounce, stale results stay visible under the progress bar instead.
        state.results.isEmpty() && !state.isSearching -> EmptyState(
            icon = Icons.Outlined.Search,
            title = "No results",
            modifier = belowHeader,
            description = "Try different keywords or clear some filters.",
            actionLabel = offer?.let(::wholeLibraryLabel),
            onAction = actions.onRemoveScope,
        )
        state.viewMode == ViewMode.GRID -> ResultsGrid(state, actions, scroll.grid, topInset)
        else -> ResultsList(state, actions, scroll.list, topInset)
    }
}

/** The header slides away while the results are scrolled down, and comes back on the way up. */
@Composable
private fun rememberHeaderShown(state: SearchUiState, scroll: SearchScroll): Boolean {
    // Saveable so it survives the round trip into a document and back.
    var isShown by rememberSaveable { mutableStateOf(true) }
    LaunchedEffect(state.hasQuery) { if (!state.hasQuery) isShown = true }
    LaunchedEffect(state.viewMode, state.hasQuery) {
        if (!state.hasQuery) return@LaunchedEffect
        val position = {
            if (state.viewMode == ViewMode.GRID) {
                scroll.grid.firstVisibleItemIndex to scroll.grid.firstVisibleItemScrollOffset
            } else {
                scroll.list.firstVisibleItemIndex to scroll.list.firstVisibleItemScrollOffset
            }
        }
        // Seed from the CURRENT position, not 0,0: on return the list state is restored to a non-zero
        // scroll, and a 0,0 seed would read that as a downward scroll and wrongly hide the header.
        var last = position()
        snapshotFlow(position).collect { (index, offset) ->
            val (lastIndex, lastOffset) = last
            val atTop = index == 0 && offset < 4
            val down = index > lastIndex || (index == lastIndex && offset > lastOffset + 6)
            val up = index < lastIndex || (index == lastIndex && offset < lastOffset - 6)
            if (atTop || up) isShown = true else if (down) isShown = false
            last = index to offset
        }
    }
    return isShown
}
