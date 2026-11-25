package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.OfflineBanner
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.favourites.FavouritesShelf

/**
 * The Collections tab without its state holder: the header, one section per collection, then the
 * folders that belong to no collection under a plain "Folders" heading.
 */
@Composable
fun CollectionsContent(
    state: CollectionsUiState,
    actions: CollectionsActions,
    modifier: Modifier = Modifier,
) {
    val collections = state.tree.filter { it.type == FolderType.COLLECTION }
    val rootFolders = state.tree.filter { it.type == FolderType.FOLDER }
    val favourites = state.favourites.visible
    ReverieRefreshBox(isRefreshing = state.isRefreshing, onRefresh = actions.onRefresh, modifier = modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
            OfflineBanner(visible = state.isOffline)
            LazyColumn(
                Modifier.weight(1f),
                // Room for the bottom navigation that overlays the list.
                contentPadding = PaddingValues(bottom = bottomBarInset() + 16.dp),
            ) {
                item { CollectionsHeader(state, actions) }
                if (favourites.isNotEmpty()) {
                    item(key = SHELF_KEY) { FavouritesShelf(favourites, actions.onOpenFavourite, actions.onSeeAllFavourites) }
                }
                if (collections.isEmpty() && rootFolders.isEmpty()) item { EmptyNote(state.filter.isNotBlank()) }
                items(collections, key = { it.id }) { collection ->
                    CollectionSection(
                        collection = collection,
                        covers = state.covers,
                        folderCount = state.folderCounts[collection.id] ?: collection.children.size,
                        expanded = state.isExpanded(collection.id),
                        actions = actions,
                        modifier = Modifier.animateItem(),
                        starredIds = state.favourites.starredFolderIds,
                    )
                }
                if (rootFolders.isNotEmpty()) item(key = ROOT_GROUP_KEY) { RootFolders(rootFolders, state, actions) }
            }
        }
    }
}

private const val ROOT_GROUP_KEY = "root-folders"
private const val SHELF_KEY = "favourites"

@Composable
private fun RootFolders(folders: List<FolderWithChildren>, state: CollectionsUiState, actions: CollectionsActions) {
    Column(Modifier.padding(top = 18.dp)) {
        Text(
            "Folders",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 20.dp, bottom = 6.dp),
        )
        FolderGroupCard(
            folders,
            state.covers,
            actions,
            accent = MaterialTheme.colorScheme.primary,
            starredIds = state.favourites.starredFolderIds,
        )
    }
}

@Composable
private fun EmptyNote(filtering: Boolean) {
    Text(
        text = if (filtering) "Nothing matches that filter." else "No collections yet. Tap + to make one.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 32.dp),
    )
}
