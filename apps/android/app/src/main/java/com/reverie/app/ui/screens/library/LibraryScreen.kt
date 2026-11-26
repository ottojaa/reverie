package com.reverie.app.ui.screens.library

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.components.CreateEditFolderSheet
import com.reverie.app.ui.components.LIBRARY_NAME
import com.reverie.app.ui.screens.browse.BrowseChrome
import com.reverie.app.ui.screens.browse.BrowseTitle
import com.reverie.app.ui.screens.browse.ChromeSelection
import com.reverie.app.ui.screens.browse.documentRowActions
import com.reverie.app.ui.screens.browse.rememberOpenDocument
import com.reverie.app.ui.screens.browse.rememberToday
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.screens.viewer.returnedDocumentId
import java.time.ZoneId

/**
 * The Library, the app's first screen. Uploads and new folders made here land at the top level.
 *
 * @param onDocumentClick [section] names the list the document was opened from, where it is not Recently added.
 * @param account the header's avatar button.
 */
@Composable
fun LibraryScreen(
    links: LibraryLinks,
    onDocumentClick: (documentId: String, aspect: Float?, section: String?) -> Unit,
    account: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: LibraryViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val backup by viewModel.backup.collectAsStateWithLifecycle()
    val covers by viewModel.covers.collectAsStateWithLifecycle()
    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val openRecent = rememberOpenDocument { id, aspect -> onDocumentClick(id, aspect, null) }
    val openUnfiled = rememberOpenDocument { id, aspect -> onDocumentClick(id, aspect, UNFILED_SECTION) }
    val today = rememberToday()
    val zone = remember { ZoneId.systemDefault() }
    var isNamingFolder by rememberSaveable { mutableStateOf(false) }
    val selectedIds = state.selectedIds
    val starredIds = favourites.starredDocumentIds
    val actions = remember(viewModel, selectedIds, starredIds) {
        LibraryActions(
            recent = documentRowActions(viewModel.recentList, selectedIds, starredIds, openRecent),
            unfiled = documentRowActions(viewModel.unfiledList, selectedIds, starredIds, openUnfiled),
            onLoadMore = viewModel::loadMore,
            onNewFolder = { isNamingFolder = true },
            onFocusConsumed = viewModel::clearViewerFocus,
            onHoldFolder = viewModel.manage::openMenu,
        )
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.onResume() }

    BrowseChrome(
        title = BrowseTitle(LIBRARY_NAME, subtitle = ""),
        ui = ui,
        folderId = null,
        isRefreshing = state.recent.isRefreshing,
        isEmpty = state.isEmpty,
        selection = ChromeSelection(selectedIds.size, viewModel::clearSelection, viewModel::moveSelected, viewModel::deleteSelected, viewModel::downloadSelected),
        unlocker = viewModel.unlocker,
        onRefresh = { viewModel.refresh() },
        onRetry = { viewModel.refresh(initial = true) },
        onBack = null,
        onOpenDocument = openRecent,
        uploadViewModel = uploadViewModel,
        favourites = viewModel.favourites,
        manage = viewModel.manage,
        modifier = modifier,
        headerActions = { openUpload ->
            IconButton(onClick = openUpload) { Icon(Icons.Outlined.Add, contentDescription = "Upload or new folder") }
            account()
        },
        onNewFolder = { isNamingFolder = true },
        notices = viewModel.notices,
    ) { slot ->
        LibraryBody(
            state = state,
            marks = LibraryMarks(
                folderCovers = covers,
                starredFolderIds = favourites.starredFolderIds,
                favouriteCount = favourites.visible.size.takeIf { favourites.isLoaded },
                backup = backup,
            ),
            links = links,
            actions = actions,
            day = LibraryDay(today, zone),
            slot = slot,
            focus = LibraryFocus(
                recent = returnedDocumentId(viewModel.viewerFocus),
                unfiled = returnedDocumentId(viewModel.viewerFocus, UNFILED_SECTION),
            ),
        )
    }

    if (isNamingFolder) {
        CreateEditFolderSheet(
            title = "New folder",
            initial = null,
            onSubmit = {
                isNamingFolder = false
                viewModel.createFolder(it)
            },
            onDismiss = { isNamingFolder = false },
        )
    }
}
