package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.domain.CachedFolders
import com.reverie.app.ui.components.MOSAIC_GAP
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.browse.BrowseHeader
import com.reverie.app.ui.screens.browse.BrowseTitle
import com.reverie.app.ui.screens.browse.PageTitle

private const val NOTHING_STARRED = "Nothing starred yet. Star a file or folder to find it here."
private const val NOT_LOADED = "Couldn't load favourites. Pull down to try again."

data class FavouritesActions(
    val onBack: () -> Unit,
    val onOpen: (FavouriteDto) -> Unit,
    val onUnstar: (FavouriteDto) -> Unit,
    val onHoldFolder: (FolderWithChildren) -> Unit,
    val onRefresh: () -> Unit,
    val onFocusConsumed: () -> Unit = {},
)

/**
 * The favourites screen without its sheets and messages: folders, photos and videos, and files, each
 * under its name when there is something in it.
 *
 * @param focusedId the document to bring into view, on return from the viewer.
 */
@Composable
fun FavouritesContent(
    state: FavouritesState,
    folders: CachedFolders,
    actions: FavouritesActions,
    modifier: Modifier = Modifier,
    isFetching: Boolean = false,
    isPulling: Boolean = false,
    focusedId: String? = null,
    listState: LazyListState = rememberLazyListState(),
) {
    val sections = remember(state) { FavouriteSections(state.visible) }
    ReverieRefreshBox(isRefreshing = isPulling, onRefresh = actions.onRefresh, modifier = modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            BrowseHeader(title = null, processingCount = 0, onProcessingClick = {}, onBack = actions.onBack)
            PageTitle(BrowseTitle("Favourites", sections.countLine()))
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                val width = maxWidth.value
                val rows = remember(sections, width) { favouriteRows(sections, width) }
                FocusScroll(rows, listState, focusedId, actions.onFocusConsumed)
                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(bottom = bottomBarInset() + 16.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    // A list item rather than a screen of its own, so an empty screen can still be pulled.
                    if (rows.isEmpty()) item { Placeholder(state.isLoaded, isFetching) }
                    items(rows, key = { it.key }) { FavouriteRowView(it, folders, actions) }
                }
            }
        }
    }
}

/** Scrolls to the row showing [focusedId] unless it is already on screen. */
@Composable
private fun FocusScroll(rows: List<FavouriteRow>, listState: LazyListState, focusedId: String?, onConsumed: () -> Unit) {
    LaunchedEffect(focusedId, rows) {
        val id = focusedId ?: return@LaunchedEffect
        if (rows.isEmpty()) return@LaunchedEffect
        val index = rows.indexOfFirst { it.shows(id) }
        if (index >= 0 && listState.layoutInfo.visibleItemsInfo.none { it.index == index }) listState.scrollToItem(index)
        onConsumed()
    }
}

@Composable
private fun FavouriteRowView(row: FavouriteRow, folders: CachedFolders, actions: FavouritesActions) {
    when (row) {
        is FavouriteRow.Heading -> Heading(row.title)
        is FavouriteRow.Folder -> FolderFavourite(row.item, folders, actions)
        is FavouriteRow.Tiles -> Row(
            Modifier.padding(bottom = MOSAIC_GAP.dp),
            horizontalArrangement = Arrangement.spacedBy(MOSAIC_GAP.dp),
        ) {
            row.items.forEach { MediaFavourite(it, row.cell, actions) }
        }
        is FavouriteRow.File -> FileFavourite(row.item, actions)
    }
}

@Composable
private fun Heading(title: String) {
    Text(
        title,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp).semantics { heading() },
    )
}

@Composable
private fun Placeholder(isLoaded: Boolean, isFetching: Boolean) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp), contentAlignment = Alignment.Center) {
        if (!isLoaded && isFetching) {
            CircularProgressIndicator()
            return@Box
        }
        Text(
            if (isLoaded) NOTHING_STARRED else NOT_LOADED,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
