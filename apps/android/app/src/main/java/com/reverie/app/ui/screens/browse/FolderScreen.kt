package com.reverie.app.ui.screens.browse

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.upload.UploadViewModel
import java.time.ZoneId

/** A folder's page: what it holds, filtered by kind with the chips, as cards or as a list. */
@Composable
fun FolderScreen(
    onDocumentClick: (documentId: String, aspect: Float?) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    onFavourite: (FavouriteDestination) -> Unit = {},
    viewModel: FolderViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val focusedId by viewModel.focusedDocumentId.collectAsStateWithLifecycle()
    val viewMode by viewModel.viewMode.collectAsStateWithLifecycle()
    val favourites by viewModel.favourites.state.collectAsStateWithLifecycle()
    val openDocument = rememberOpenDocument(onDocumentClick)
    val today = rememberToday()
    val zone = remember { ZoneId.systemDefault() }
    val shown = state.unlessLocked(ui.lockedFolderId != null)
    val selectedIds = shown.feed.selectedIds
    val starredIds = favourites.starredDocumentIds

    val actions = remember(viewModel, selectedIds, starredIds) {
        folderRowActions(viewModel, selectedIds, starredIds, openDocument)
    }

    BrowseChrome(
        title = BrowseTitle(
            text = ui.folder?.name ?: "Folder",
            subtitle = folderSubtitle(shown.total, shown.matching, ui.folder?.description),
            isFolder = true,
            compact = true,
        ),
        ui = ui,
        folderId = viewModel.folderId,
        isRefreshing = shown.feed.isRefreshing,
        isEmpty = shown.feed.documents.documents.isEmpty(),
        selection = ChromeSelection(selectedIds.size, viewModel::clearSelection, viewModel::deleteSelected, viewModel::downloadSelected),
        unlocker = viewModel.unlocker,
        onRefresh = { viewModel.refresh() },
        onRetry = { viewModel.refresh(initial = true) },
        onBack = onBack,
        onOpenDocument = openDocument,
        uploadViewModel = uploadViewModel,
        favourites = viewModel.favourites,
        modifier = modifier,
        onFavourite = onFavourite,
        headerActions = { viewMode?.let { ViewSwitch(it, viewModel::setViewMode) } },
        belowHeader = { FolderChipRow(shown.chips, shown.selected, viewModel::select) },
    ) { slot ->
        FolderBody(
            state = shown,
            viewMode = viewMode,
            actions = actions,
            today = today,
            zone = zone,
            focusedId = focusedId,
            onFocusConsumed = viewModel::clearFocusedDocument,
            onLoadMore = viewModel::loadMore,
            error = ui.error,
            slot = slot,
        )
    }
}

/** Tap opens (or, once something is selected, selects); long press starts or extends a selection. */
internal fun folderRowActions(
    viewModel: FolderViewModel,
    selectedIds: Set<String>,
    starredIds: Set<String>,
    openDocument: (DocumentDto) -> Unit,
): RowActions {
    val selecting = selectedIds.isNotEmpty()
    return RowActions(
        selected = { it.id in selectedIds },
        onClick = { doc ->
            if (selecting) {
                viewModel.toggleSelect(doc.id)
            } else {
                // Publish the shown list's order so the viewer swipes through it and nothing else.
                viewModel.prepareSequence()
                viewModel.prefetch(doc)
                openDocument(doc)
            }
        },
        onLongClick = { doc -> if (selecting) viewModel.toggleSelect(doc.id) else viewModel.enterSelection(doc.id) },
        starred = { it.id in starredIds },
        onToggleStar = { viewModel.favourites.toggle(FavouriteKey(FavouriteType.DOCUMENT, it.id)) },
    )
}
