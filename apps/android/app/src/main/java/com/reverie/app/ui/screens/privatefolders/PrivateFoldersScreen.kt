package com.reverie.app.ui.screens.privatefolders

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.counted
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.components.FolderRow
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.browse.BrowseHeader
import com.reverie.app.ui.screens.browse.BrowseTitle
import com.reverie.app.ui.screens.favourites.FavouriteHost
import com.reverie.app.ui.screens.favourites.ReverieSnackbarHost
import com.reverie.app.ui.screens.manage.ManageHost

private const val NO_PRIVATE_FOLDERS = "No private folders. To make one, hold a folder and choose Make private."

data class PrivateFoldersState(
    /** Null until the cached folders have been read. */
    val folders: List<FolderWithChildren>? = null,
    val starredIds: Set<String> = emptySet(),
    val isPulling: Boolean = false,
)

data class PrivateFoldersActions(
    val onBack: () -> Unit,
    val onOpenFolder: (String) -> Unit,
    val onHoldFolder: (FolderWithChildren) -> Unit,
    val onRefresh: () -> Unit,
)

/** The private folders, opened from the account sheet. A locked one asks for the password where it opens. */
@Composable
fun PrivateFoldersScreen(
    onBack: () -> Unit,
    onOpenFolder: (String) -> Unit,
    viewModel: PrivateFoldersViewModel = hiltViewModel(),
) {
    val folders by viewModel.folders.collectAsStateWithLifecycle()
    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val isPulling by viewModel.isPulling.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.load() }

    val starredIds = folders.orEmpty()
        .filter { favourites.isStarred(FavouriteKey(FavouriteType.FOLDER, it.id)) }
        .mapTo(mutableSetOf()) { it.id }
    val actions = PrivateFoldersActions(onBack, onOpenFolder, viewModel.manage::openMenu, viewModel::pullToRefresh)

    Box(Modifier.fillMaxSize()) {
        PrivateFoldersContent(PrivateFoldersState(folders, starredIds, isPulling), actions)
        ReverieSnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomBarInset()))
    }
    FavouriteHost(viewModel.favourites, snackbarHostState)
    ManageHost(viewModel.manage, snackbarHostState)
}

@Composable
fun PrivateFoldersContent(state: PrivateFoldersState, actions: PrivateFoldersActions, modifier: Modifier = Modifier) {
    ReverieRefreshBox(isRefreshing = state.isPulling, onRefresh = actions.onRefresh, modifier = modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            val count = state.folders?.size?.takeIf { it > 0 }?.let { counted(it, "folder") }
            BrowseHeader(
                title = BrowseTitle("Private folders", count.orEmpty()),
                processingCount = 0,
                onProcessingClick = {},
                onBack = actions.onBack,
            )
            LazyColumn(
                contentPadding = PaddingValues(bottom = bottomBarInset() + 16.dp),
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                // A list item rather than a screen of its own, so an empty screen can still be pulled.
                if (state.folders?.isEmpty() == true) item { NoFolders() }
                items(state.folders.orEmpty(), key = { it.id }) { folder ->
                    FolderRow(
                        folder = folder,
                        cover = null,
                        meta = folderMeta(folder),
                        onClick = { actions.onOpenFolder(folder.id) },
                        onLongClick = { actions.onHoldFolder(folder) },
                        starred = folder.id in state.starredIds,
                    )
                }
            }
        }
    }
}

@Composable
private fun NoFolders() {
    Text(
        NO_PRIVATE_FOLDERS,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
    )
}
