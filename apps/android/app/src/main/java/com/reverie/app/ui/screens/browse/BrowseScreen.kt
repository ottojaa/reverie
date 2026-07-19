package com.reverie.app.ui.screens.browse

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.components.ComingSoonSheet
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.DocumentCardSkeleton
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.components.MosaicDocumentGrid
import com.reverie.app.ui.components.OfflineBanner
import com.reverie.app.ui.components.ProcessingStatusBadge
import com.reverie.app.ui.components.ReverieFab
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.components.SelectionTopBar
import com.reverie.app.ui.components.UploadStatusPill
import com.reverie.app.ui.components.rememberSkeletonVisible
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.ui.navigation.LocalBottomBarScrollState
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.viewer.isImageDocument
import com.reverie.app.ui.screens.upload.UploadActionSheet
import com.reverie.app.ui.screens.upload.UploadReviewSheet
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.util.enqueueDownload
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowseScreen(
    onDocumentClick: (documentId: String, aspect: Float?) -> Unit,
    modifier: Modifier = Modifier,
    folderId: String? = null,
    onBack: (() -> Unit)? = null,
    viewModel: BrowseViewModel = hiltViewModel(),
    uploadViewModel: UploadViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activeUploads by uploadViewModel.activeCount.collectAsStateWithLifecycle()
    val review by uploadViewModel.review.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    // Files grid is a LazyColumn of packed bands, so it uses a list state (not grid).
    val listState = rememberLazyListState()
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var showCanvasSoon by remember { mutableStateOf(false) }
    var showUploadActions by remember { mutableStateOf(false) }

    val onUploadClick: () -> Unit = { showUploadActions = true }
    // Collapsing top bar: hides on scroll down, returns on scroll up.
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()

    // Infinite scroll and the return-transform scroll sync live inside MosaicDocumentGrid, which
    // owns the packed sections those effects key on. We only forward the focused id here.
    val focusedId by viewModel.focusedDocumentId.collectAsStateWithLifecycle()
    val layoutMode by viewModel.gridLayoutMode.collectAsStateWithLifecycle()
    val featureEvery by viewModel.mosaicFeatureEvery.collectAsStateWithLifecycle()

    // Drive the shell's bottom-bar visibility off the same collapsing-top-bar state, so both bars
    // move in lockstep and the bottom bar reappears at the top. Honored only when the setting is on.
    val bottomBarScroll = LocalBottomBarScrollState.current
    androidx.compose.runtime.LaunchedEffect(scrollBehavior, bottomBarScroll) {
        val bar = bottomBarScroll ?: return@LaunchedEffect
        androidx.compose.runtime.snapshotFlow { scrollBehavior.state.collapsedFraction > 0.5f }
            .distinctUntilChanged()
            .collect { collapsed -> bar.value = !collapsed }
    }

    // Pull-to-refresh wraps the whole Scaffold so its indicator floats over the app-bar region
    // instead of dropping below the top bar.
    ReverieRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = { viewModel.refresh() },
        modifier = modifier,
    ) {
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        // The normal top bar stays mounted (so the grid's top inset never changes); the selection
        // bar is drawn as an opaque overlay over it (below) instead of swapping in this slot, which
        // is what used to shift the grid content down when selection started.
        topBar = {
            BrowseTopBar(
                isFolder = viewModel.folderId != null,
                folderName = state.folder?.name,
                folderEmoji = state.folder?.emoji,
                subtitle = folderSubtitle(state.folder?.description, state.documents.size),
                processingCount = state.processingCount,
                onBack = onBack,
                onCanvas = { showCanvasSoon = true },
                scrollBehavior = scrollBehavior,
            )
        },
        floatingActionButton = {
            ReverieFab(
                onClick = onUploadClick,
                visible = !state.inSelectionMode,
                modifier = Modifier.padding(bottom = bottomBarInset()),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        // Top inset lives in the scroll content (grid contentPadding) so it scrolls away with the
        // collapsing bar; the bottom reserves space for the overlaid nav bar.
        // Edge-to-edge gallery: no horizontal padding, hairline gaps between tiles.
        val gridPadding = PaddingValues(
            start = 0.dp,
            end = 0.dp,
            top = innerPadding.calculateTopPadding() + 4.dp,
            bottom = bottomBarInset() + 12.dp,
        )
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                state.isLoading -> LoadingGrid(contentPadding = gridPadding)
                state.error != null && state.documents.isEmpty() ->
                    Box(Modifier.padding(innerPadding).fillMaxSize()) {
                        ErrorState(message = state.error!!, onRetry = { viewModel.refresh(initial = true) })
                    }
                state.documents.isEmpty() ->
                    Box(Modifier.padding(innerPadding).fillMaxSize()) {
                        EmptyState(
                            icon = Icons.Outlined.FolderOpen,
                            title = if (viewModel.folderId != null) "This folder is empty" else "No documents yet",
                            description = "Tap + to upload or scan a document.",
                            actionLabel = "Upload",
                            onAction = onUploadClick,
                        )
                    }
                else -> MosaicDocumentGrid(
                    documents = state.documents,
                    listState = listState,
                    contentPadding = gridPadding,
                    layoutMode = layoutMode,
                    featureEvery = featureEvery,
                    hasMore = state.hasMore,
                    onLoadMore = viewModel::loadMore,
                    focusedId = focusedId,
                    // Consume the focus signal so later list updates (e.g. a thumbnail-complete
                    // refetch) don't re-scroll the grid.
                    onFocusConsumed = viewModel::clearFocusedDocument,
                    selected = { document -> document.id in state.selectedIds },
                    onClick = { document ->
                        if (state.inSelectionMode) {
                            viewModel.toggleSelect(document.id)
                        } else {
                            // Publish this grid's order so the viewer can swipe through it.
                            viewModel.prepareSequence()
                            // Only images size the dive transform to their aspect — for other file
                            // types the thumbnail aspect would letterbox the full-screen viewer.
                            onDocumentClick(
                                document.id,
                                if (isImageDocument(document)) document.mediaAspectOrNull() else null,
                            )
                        }
                    },
                    onLongClick = { document ->
                        if (state.inSelectionMode) viewModel.toggleSelect(document.id)
                        else viewModel.enterSelection(document.id)
                    },
                )
            }

            // Selection bar overlays the top region (opaque) rather than replacing the top bar, so
            // entering selection never changes the grid's reserved top inset — no content shift.
            AnimatedVisibility(
                visible = state.inSelectionMode,
                enter = slideInVertically { -it } + fadeIn(),
                exit = slideOutVertically { -it } + fadeOut(),
                modifier = Modifier.align(Alignment.TopCenter),
            ) {
                SelectionTopBar(
                    count = state.selectedIds.size,
                    allPrivate = state.allSelectedPrivate,
                    onClose = viewModel::clearSelection,
                    onTogglePrivate = viewModel::togglePrivateSelected,
                    onDownload = {
                        viewModel.downloadSelected { targets ->
                            targets.forEach { enqueueDownload(context, it.url, it.filename) }
                            if (targets.isNotEmpty()) {
                                scope.launch { snackbarHostState.showSnackbar(downloadStartedMessage(targets.size)) }
                            }
                        }
                    },
                    onDelete = { showDeleteConfirm = true },
                )
            }

            OfflineBanner(
                visible = state.isOffline && !state.inSelectionMode,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = innerPadding.calculateTopPadding()),
            )

            if (activeUploads > 0 && review == null) {
                UploadStatusPill(
                    count = activeUploads,
                    onClick = { showUploadActions = true },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = bottomBarInset() + 16.dp),
                )
            }
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
    scrollBehavior: TopAppBarScrollBehavior,
) {
    var menuOpen by remember { mutableStateOf(false) }
    TopAppBar(
        // A top scrim keeps "My Files" and the actions legible over bright gallery content while the
        // bar container stays transparent (edge-to-edge). Surface-tinted so it adapts to light/dark and
        // backs the onSurface title/icons in either theme; the middle stop keeps it strong through the
        // title row, then it fades to nothing. It rides with the bar as it collapses on scroll.
        modifier = Modifier.background(
            Brush.verticalGradient(
                listOf(
                    MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                    MaterialTheme.colorScheme.surface.copy(alpha = 0.5f),
                    Color.Transparent,
                ),
            ),
        ),
        scrollBehavior = scrollBehavior,
        windowInsets = TopAppBarDefaults.windowInsets,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = Color.Transparent,
            scrolledContainerColor = Color.Transparent,
            // Match the title so the action icons (grid size, more) read as clearly as "My Files".
            titleContentColor = MaterialTheme.colorScheme.onSurface,
            navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
            actionIconContentColor = MaterialTheme.colorScheme.onSurface,
        ),
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
                // Wrap button + menu in a Box so the menu anchors to the button.
                Box {
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
            }
        },
    )
}

@Composable
private fun LoadingGrid(contentPadding: PaddingValues) {
    val visible = rememberSkeletonVisible(isLoading = true)
    if (!visible) return
    // A brief placeholder only — a fixed 3-wide square grid, since the justified layout needs real
    // document dimensions we don't have yet.
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = contentPadding,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(2.dp),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(12) { DocumentCardSkeleton() }
    }
}

private fun folderSubtitle(description: String?, count: Int): String {
    val files = "$count ${plural(count)}"
    return if (description.isNullOrBlank()) files else "$description · $files"
}

private fun plural(n: Int): String = if (n == 1) "file" else "files"

private fun downloadStartedMessage(n: Int): String = "Downloading $n ${plural(n)}"
