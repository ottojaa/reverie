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
import androidx.compose.runtime.LaunchedEffect
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
import com.reverie.app.ui.components.LockCheck
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.browse.BrowseHeader
import com.reverie.app.ui.screens.browse.BrowseTitle
import com.reverie.app.ui.screens.manage.PickingPage
import com.reverie.app.ui.screens.manage.RowSelection
import com.reverie.app.ui.screens.manage.pickFrom

private const val LOCK_ROW_KEY = "lock"
private const val NO_PRIVATE_FOLDERS = "No private folders. To make one, hold a folder, then choose Make private from ⋮."

data class PrivateFoldersState(
    /** Null until the cached folders have been read. */
    val folders: List<FolderWithChildren>? = null,
    val starredIds: Set<String> = emptySet(),
    val isPulling: Boolean = false,
    /** What they open with. */
    val lock: LockCheck = LockCheck.Checking,
)

data class PrivateFoldersActions(
    val onBack: () -> Unit,
    val onOpenFolder: (String) -> Unit,
    val onRefresh: () -> Unit,
    val onOpenLockSettings: () -> Unit = {},
    val onRetryLock: () -> Unit = {},
    /** The folder rows' part in the screen's selection. */
    val selection: RowSelection = RowSelection(),
)

/**
 * The private folders, opened from the account sheet, and what opens them. A locked one asks to be unlocked where
 * it opens. With [openLockSettings] the lock settings open as soon as they can, and [onLockSettingsOpened] hears it.
 */
@Composable
fun PrivateFoldersScreen(
    onBack: () -> Unit,
    onOpenFolder: (String) -> Unit,
    openLockSettings: Boolean = false,
    onLockSettingsOpened: () -> Unit = {},
    viewModel: PrivateFoldersViewModel = hiltViewModel(),
) {
    val folders by viewModel.folders.collectAsStateWithLifecycle()
    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val isPulling by viewModel.isPulling.collectAsStateWithLifecycle()
    val selectedIds by viewModel.selection.ids.collectAsStateWithLifecycle()
    val picked = remember(folders, selectedIds) { pickFrom(selectedIds, folders = folders.orEmpty()) }

    val lockStatus by viewModel.lockStatus.collectAsStateWithLifecycle()
    val lockSettings by viewModel.lock.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.load() }
    LaunchedEffect(openLockSettings, lockStatus == null) {
        // Waits for the status: the settings cannot open before it is known that the account has a password.
        if (!openLockSettings || lockStatus == null) return@LaunchedEffect
        viewModel.lock.open()
        onLockSettingsOpened()
    }

    val starredIds = folders.orEmpty()
        .filter { favourites.isStarred(FavouriteKey(FavouriteType.FOLDER, it.id)) }
        .mapTo(mutableSetOf()) { it.id }
    val actions = PrivateFoldersActions(
        onBack = onBack,
        onOpenFolder = onOpenFolder,
        onRefresh = viewModel::pullToRefresh,
        selection = RowSelection(picked.ids, viewModel.selection::toggle),
        onOpenLockSettings = viewModel.lock::open,
        onRetryLock = viewModel.lock::refresh,
    )
    val lock = toLockCheck(lockStatus, lockSettings.hasFailed)

    PickingPage(picked, viewModel.selection, viewModel.manage, viewModel.favourites, snackbarHostState = snackbarHostState) {
        PrivateFoldersContent(PrivateFoldersState(folders, starredIds, isPulling, lock), actions)
    }
    LockSettingsHost(viewModel.lock, lockStatus, lockSettings, snackbarHostState)
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
                item(key = LOCK_ROW_KEY) { LockSectionRow(state.lock, actions.onOpenLockSettings, actions.onRetryLock) }
                // A list item rather than a screen of its own, so an empty screen can still be pulled.
                if (state.folders?.isEmpty() == true) item { NoFolders() }
                items(state.folders.orEmpty(), key = { it.id }) { folder ->
                    FolderRow(
                        folder = folder,
                        cover = null,
                        meta = folderMeta(folder),
                        onClick = { actions.selection.tap(folder.id) { actions.onOpenFolder(folder.id) } },
                        onLongClick = { actions.selection.toggle(folder.id) },
                        starred = folder.id in state.starredIds,
                        selected = folder.id in actions.selection,
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
