package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.components.ComingSoonSheet
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.DocumentCard
import com.reverie.app.ui.components.DocumentCardSkeleton
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.components.OfflineBanner
import com.reverie.app.ui.components.ProcessingStatusBadge
import com.reverie.app.ui.components.ReverieFab
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.components.SelectionTopBar
import com.reverie.app.ui.components.UploadStatusPill
import com.reverie.app.ui.components.rememberSkeletonVisible
import com.reverie.app.ui.screens.upload.UploadActionSheet
import com.reverie.app.ui.screens.upload.UploadReviewSheet
import com.reverie.app.ui.screens.upload.UploadViewModel
import kotlinx.coroutines.flow.distinctUntilChanged

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowseScreen(
    onDocumentClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    folderId: String? = null,
    onBack: (() -> Unit)? = null,
    viewModel: BrowseViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val activeUploads by uploadViewModel.activeCount.collectAsStateWithLifecycle()
    val review by uploadViewModel.review.collectAsStateWithLifecycle()
    val gridState = rememberLazyGridState()
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var showCanvasSoon by remember { mutableStateOf(false) }
    var showUploadActions by remember { mutableStateOf(false) }

    val onUploadClick: () -> Unit = { showUploadActions = true }

    // Infinite scroll: fetch the next page as we approach the end.
    androidx.compose.runtime.LaunchedEffect(gridState, state.hasMore, state.documents.size) {
        androidx.compose.runtime.snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .collect { lastIndex ->
                if (state.hasMore && lastIndex >= state.documents.size - 6) viewModel.loadMore()
            }
    }

    Scaffold(
        modifier = modifier,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        topBar = {
            if (state.inSelectionMode) {
                SelectionTopBar(
                    count = state.selectedIds.size,
                    allPrivate = state.allSelectedPrivate,
                    onClose = viewModel::clearSelection,
                    onTogglePrivate = viewModel::togglePrivateSelected,
                    onDelete = { showDeleteConfirm = true },
                )
            } else {
                BrowseTopBar(
                    isFolder = viewModel.folderId != null,
                    folderName = state.folder?.name,
                    folderEmoji = state.folder?.emoji,
                    subtitle = folderSubtitle(state.folder?.description, state.documents.size),
                    processingCount = state.processingCount,
                    onBack = onBack,
                    onCanvas = { showCanvasSoon = true },
                )
            }
        },
        floatingActionButton = {
            ReverieFab(onClick = onUploadClick, visible = !state.inSelectionMode)
        },
    ) { innerPadding ->
      androidx.compose.foundation.layout.Box(modifier = Modifier.padding(innerPadding).fillMaxSize()) {
        Column {
            OfflineBanner(visible = state.isOffline)

            when {
                state.isLoading -> LoadingGrid()
                state.error != null && state.documents.isEmpty() ->
                    ErrorState(message = state.error!!, onRetry = { viewModel.refresh(initial = true) })
                state.documents.isEmpty() ->
                    EmptyState(
                        icon = Icons.Outlined.FolderOpen,
                        title = if (viewModel.folderId != null) "This folder is empty" else "No documents yet",
                        description = "Tap + to upload or scan a document.",
                        actionLabel = "Upload",
                        onAction = onUploadClick,
                    )
                else -> ReverieRefreshBox(
                    isRefreshing = state.isRefreshing,
                    onRefresh = { viewModel.refresh() },
                ) {
                    LazyVerticalGrid(
                        state = gridState,
                        columns = GridCells.Adaptive(160.dp),
                        contentPadding = PaddingValues(12.dp),
                        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(state.documents, key = { it.id }) { document ->
                            DocumentCard(
                                document = document,
                                selected = document.id in state.selectedIds,
                                onClick = {
                                    if (state.inSelectionMode) viewModel.toggleSelect(document.id)
                                    else onDocumentClick(document.id)
                                },
                                onLongClick = {
                                    if (state.inSelectionMode) viewModel.toggleSelect(document.id)
                                    else viewModel.enterSelection(document.id)
                                },
                            )
                        }
                    }
                }
            }
        }
        if (activeUploads > 0 && review == null) {
            UploadStatusPill(
                count = activeUploads,
                onClick = { showUploadActions = true },
                modifier = androidx.compose.ui.Modifier
                    .align(androidx.compose.ui.Alignment.BottomCenter)
                    .padding(bottom = 16.dp),
            )
        }
      }
    }

    if (showUploadActions) {
        UploadActionSheet(
            onFilesPicked = { uris ->
                uploadViewModel.beginReview(uris, viewModel.folderId)
                showUploadActions = false
            },
            loadMedia = { uploadViewModel.loadMedia() },
            onDismiss = { showUploadActions = false },
        )
    }
    UploadReviewSheet(viewModel = uploadViewModel)

    if (showDeleteConfirm) {
        ConfirmDialog(
            title = "Delete ${state.selectedIds.size} ${plural(state.selectedIds.size)}?",
            message = "These files will be permanently deleted — this can't be undone.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDeleteConfirm = false
                viewModel.deleteSelected()
            },
            onDismiss = { showDeleteConfirm = false },
        )
    }

    if (showCanvasSoon) {
        ComingSoonSheet(
            icon = Icons.Outlined.Dashboard,
            title = "Canvas is coming soon",
            description = "Explore your documents in a spatial 3D view — available on desktop today, coming to Android.",
            onDismiss = { showCanvasSoon = false },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrowseTopBar(
    isFolder: Boolean,
    folderName: String?,
    folderEmoji: String?,
    subtitle: String,
    processingCount: Int,
    onBack: (() -> Unit)?,
    onCanvas: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    TopAppBar(
        windowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        title = {
            Column {
                Text(
                    text = if (isFolder) buildString {
                        folderEmoji?.let { append("$it  ") }
                        append(folderName ?: "Folder")
                    } else "My Files",
                    style = MaterialTheme.typography.titleLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        },
        navigationIcon = {
            if (isFolder && onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            }
        },
        actions = {
            ProcessingStatusBadge(count = processingCount)
            if (isFolder) {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = "More")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Open in Canvas") },
                        leadingIcon = { Icon(Icons.Outlined.Dashboard, contentDescription = null) },
                        onClick = { menuOpen = false; onCanvas() },
                    )
                }
            }
        },
    )
}

@Composable
private fun LoadingGrid() {
    val visible = rememberSkeletonVisible(isLoading = true)
    if (!visible) return
    LazyVerticalGrid(
        columns = GridCells.Adaptive(160.dp),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(9) { DocumentCardSkeleton(Modifier.fillMaxSize()) }
    }
}

private fun folderSubtitle(description: String?, count: Int): String {
    val files = "$count ${plural(count)}"
    return if (description.isNullOrBlank()) files else "$description · $files"
}

private fun plural(n: Int): String = if (n == 1) "file" else "files"
