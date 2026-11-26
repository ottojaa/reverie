package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.components.ComingSoonSheet
import com.reverie.app.ui.components.CreateEditFolderSheet
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.screens.viewer.returnedDocumentId
import java.time.ZoneId

/** A folder's page: the folders inside it, then its own documents. Uploads and new folders land in it. */
@Composable
fun FolderScreen(
    onDocumentClick: (documentId: String, aspect: Float?) -> Unit,
    onBack: () -> Unit,
    onOpenFolder: (folderId: String) -> Unit,
    onOpenCrumb: (folderId: String?) -> Unit,
    onSearch: (SearchScope) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: FolderViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val covers by viewModel.covers.collectAsStateWithLifecycle()
    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val layoutMode by viewModel.gridLayoutMode.collectAsStateWithLifecycle()
    val featureEvery by viewModel.mosaicFeatureEvery.collectAsStateWithLifecycle()
    val focusedId = returnedDocumentId(viewModel.viewerFocus)
    val openDocument = rememberOpenDocument(onDocumentClick)
    val today = rememberToday()
    val zone = remember { ZoneId.systemDefault() }
    var isNamingFolder by rememberSaveable { mutableStateOf(false) }
    var isCanvasSoon by rememberSaveable { mutableStateOf(false) }
    val shown = state.unlessLocked(ui.lockedFolderId != null)
    val name = shown.node?.name ?: ui.folder?.name ?: "Folder"
    val isEmpty = shown.isEmptyOfDocuments && shown.node?.children.isNullOrEmpty()
    val layout = remember(layoutMode, featureEvery, today, zone) { FeedLayout(layoutMode, featureEvery, today, zone) }
    val selectedIds = shown.selectedIds
    val starredIds = favourites.starredDocumentIds
    val actions = remember(viewModel, selectedIds, starredIds) {
        documentRowActions(viewModel, selectedIds, starredIds, openDocument)
    }

    BrowseChrome(
        // The page carries its own title, unless something else takes its place.
        title = BrowseTitle(name, subtitle = "").takeIf { ui.replacesList(isEmpty) },
        ui = ui,
        folderId = viewModel.folderId,
        isRefreshing = shown.isRefreshing,
        isEmpty = isEmpty,
        selection = ChromeSelection(selectedIds.size, viewModel::clearSelection, viewModel::moveSelected, viewModel::deleteSelected, viewModel::downloadSelected),
        unlocker = viewModel.unlocker,
        onRefresh = { viewModel.refresh() },
        onRetry = { viewModel.refresh(initial = true) },
        onBack = onBack,
        onOpenDocument = openDocument,
        uploadViewModel = uploadViewModel,
        favourites = viewModel.favourites,
        manage = viewModel.manage,
        modifier = modifier,
        headerActions = { openUpload ->
            FolderActions(
                name = name,
                onSearch = { onSearch(SearchScope.Folder(viewModel.folderId)) }.takeIf { shown.isSearchable },
                onAdd = openUpload,
                onCanvas = { isCanvasSoon = true },
            )
        },
        onNewFolder = { isNamingFolder = true },
        notices = viewModel.notices,
    ) { slot ->
        FolderBody(
            state = shown,
            name = name,
            description = ui.folder?.description,
            links = FolderLinks(covers, favourites.starredFolderIds, onOpenFolder, onOpenCrumb, onHold = viewModel.manage::openMenu),
            layout = layout,
            actions = actions,
            focusedId = focusedId,
            onFocusConsumed = viewModel::clearViewerFocus,
            onLoadMore = viewModel::loadMore,
            error = ui.error,
            slot = slot,
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
    if (isCanvasSoon) {
        ComingSoonSheet(
            icon = Icons.Outlined.Dashboard,
            title = "Canvas is coming soon",
            description = "Explore your documents in a spatial 3D view — available on desktop today, coming to Android.",
            onDismiss = { isCanvasSoon = false },
        )
    }
}

/** The folder page's buttons: search (where [onSearch] is given), add, and the overflow menu. */
@Composable
fun FolderActions(name: String, onSearch: (() -> Unit)?, onAdd: () -> Unit, onCanvas: () -> Unit) {
    if (onSearch != null) {
        IconButton(onClick = onSearch) { Icon(Icons.Outlined.Search, contentDescription = "Search in $name") }
    }
    IconButton(onClick = onAdd) { Icon(Icons.Outlined.Add, contentDescription = "Add files or a folder here") }
    var isOpen by remember { mutableStateOf(false) }
    // The menu anchors to the Box around its button.
    Box {
        IconButton(onClick = { isOpen = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More options") }
        DropdownMenu(expanded = isOpen, onDismissRequest = { isOpen = false }) {
            DropdownMenuItem(
                text = { Text("Open in Canvas") },
                leadingIcon = { Icon(Icons.Outlined.Dashboard, contentDescription = null) },
                onClick = { isOpen = false; onCanvas() },
            )
        }
    }
}
