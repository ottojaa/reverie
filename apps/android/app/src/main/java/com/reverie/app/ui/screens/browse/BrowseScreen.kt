package com.reverie.app.ui.screens.browse

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.ui.components.ComingSoonSheet
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.components.OfflineBanner
import com.reverie.app.ui.components.ReverieFab
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.components.SelectionTopBar
import com.reverie.app.ui.components.UploadStatusPill
import com.reverie.app.ui.components.VaultUnlockSheet
import com.reverie.app.ui.navigation.LocalBottomBarScrollState
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.upload.UploadActionSheet
import com.reverie.app.ui.screens.upload.UploadReviewSheet
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.screens.viewer.isImageDocument
import com.reverie.app.ui.screens.viewer.isVideoDocument
import com.reverie.app.util.enqueueDownload
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
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
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var showCanvasSoon by remember { mutableStateOf(false) }
    var showUploadActions by remember { mutableStateOf(false) }
    var showProcessing by remember { mutableStateOf(false) }
    val unlockPrompt by viewModel.unlocker.prompt.collectAsStateWithLifecycle()

    val onUploadClick: () -> Unit = { showUploadActions = true }
    // Media (images + videos) size the dive transform to their aspect — the morph box is the
    // content rect the poster grows into. Other file types morph a full-screen stand-in instead
    // (see DocumentPage).
    val openDocument: (DocumentDto) -> Unit = { document ->
        val isMedia = isImageDocument(document) || isVideoDocument(document)
        onDocumentClick(document.id, if (isMedia) document.mediaAspectOrNull() else null)
    }

    // The header slides away on scroll down and returns on a small scroll up. No bar is placed, so
    // the limit is the header's own measured height, set below.
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    BottomBarFollowsHeader(scrollBehavior)

    val focusedId by viewModel.focusedDocumentId.collectAsStateWithLifecycle()
    val layoutMode by viewModel.gridLayoutMode.collectAsStateWithLifecycle()
    val featureEvery by viewModel.mosaicFeatureEvery.collectAsStateWithLifecycle()
    val today = remember { LocalDate.now() }
    val zone = remember { ZoneId.systemDefault() }
    val layout = remember(layoutMode, featureEvery, today, zone) { FeedLayout(layoutMode, featureEvery, today, zone) }

    val listStates = rememberTabListStates()
    var heading by remember { mutableStateOf<FeedItem.Header?>(null) }
    var headerPx by remember { mutableIntStateOf(0) }
    LaunchedEffect(headerPx) { scrollBehavior.state.heightOffsetLimit = -headerPx.toFloat() }
    val density = LocalDensity.current
    val bandPx = WindowInsets.statusBars.getTop(density) + with(density) { BAND_HEIGHT.roundToPx() }

    val actions = RowActions(
        selected = { document -> document.id in state.selectedIds },
        onClick = { document ->
            if (state.inSelectionMode) {
                viewModel.toggleSelect(document.id)
            } else {
                // Publish this tab's order so the viewer swipes through it, then warm the signed URL and
                // full-res image so it is ready when the dive transition finishes.
                viewModel.prepareSequence()
                viewModel.prefetch(document)
                openDocument(document)
            }
        },
        onLongClick = { document ->
            if (state.inSelectionMode) viewModel.toggleSelect(document.id) else viewModel.enterSelection(document.id)
        },
    )

    // Pull-to-refresh wraps the whole Scaffold so its indicator floats over the header.
    ReverieRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = { viewModel.refresh() },
        modifier = modifier,
    ) {
        Scaffold(
            modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            floatingActionButton = {
                ReverieFab(
                    onClick = onUploadClick,
                    visible = !state.inSelectionMode,
                    modifier = Modifier.padding(bottom = bottomBarInset()),
                )
            },
            snackbarHost = { SnackbarHost(snackbarHostState) },
        ) {
            Box(Modifier.fillMaxSize()) {
                BrowseBody(
                    state = state,
                    listStates = listStates,
                    contentPadding = PaddingValues(top = with(density) { headerPx.toDp() }, bottom = bottomBarInset() + 12.dp),
                    layout = layout,
                    actions = actions,
                    inFolder = viewModel.folderId != null,
                    focusedId = focusedId,
                    scrollBehavior = scrollBehavior,
                    viewModel = viewModel,
                    onHeading = { heading = it },
                    onUpload = onUploadClick,
                )
                // Under the header: it is revealed as the header slides up and fades in with it.
                PinnedBand(
                    heading = heading,
                    processingCount = state.processingCount,
                    onProcessingClick = { showProcessing = true },
                    visibility = { scrollBehavior.state.collapsedFraction },
                    modifier = Modifier.align(Alignment.TopCenter),
                )
                BrowseHeader(
                    title = BrowseTitle(
                        text = titleOf(viewModel.folderId != null, state),
                        subtitle = tabSubtitle(state.tab, state.total, state.folder?.description),
                        isFolder = viewModel.folderId != null,
                    ),
                    tab = state.tab,
                    processingCount = state.processingCount,
                    onSelectTab = viewModel::selectTab,
                    onProcessingClick = { showProcessing = true },
                    onCanvas = { showCanvasSoon = true },
                    onBack = onBack,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .onSizeChanged { headerPx = it.height }
                        .graphicsLayer { translationY = scrollBehavior.state.heightOffset },
                )

                // Selection bar overlays the header (opaque) so entering selection never moves the list.
                AnimatedVisibility(
                    visible = state.inSelectionMode,
                    enter = slideInVertically { -it } + fadeIn(),
                    exit = slideOutVertically { -it } + fadeOut(),
                    modifier = Modifier.align(Alignment.TopCenter),
                ) {
                    SelectionTopBar(
                        count = state.selectedIds.size,
                        onClose = viewModel::clearSelection,
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

                // Rides the header's bottom edge, but never rises above the pinned band.
                OfflineBanner(
                    visible = state.isOffline && !state.inSelectionMode,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .offset { IntOffset(0, max(headerPx + scrollBehavior.state.heightOffset.roundToInt(), bandPx)) },
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

    if (showProcessing) {
        ProcessingSheet(
            onOpenDocument = { document ->
                showProcessing = false
                openDocument(document)
            },
            onDismiss = { showProcessing = false },
        )
    }

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

    unlockPrompt?.let { prompt ->
        VaultUnlockSheet(
            prompt = prompt,
            onSubmit = viewModel.unlocker::submit,
            onDismiss = viewModel.unlocker::dismiss,
        )
    }
}

/**
 * What fills the screen under the header: the four tabs, or — replacing them — the lock prompt,
 * the load error, or a skeleton until the last-used tab is known.
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun BrowseBody(
    state: BrowseUiState,
    listStates: Map<BrowseTab, LazyListState>,
    contentPadding: PaddingValues,
    layout: FeedLayout,
    actions: RowActions,
    inFolder: Boolean,
    focusedId: String?,
    scrollBehavior: TopAppBarScrollBehavior,
    viewModel: BrowseViewModel,
    onHeading: (FeedItem.Header?) -> Unit,
    onUpload: () -> Unit,
) {
    val belowHeader = Modifier.padding(top = contentPadding.calculateTopPadding()).fillMaxSize()
    when {
        !state.ready -> LoadingGrid(contentPadding)
        state.lockedFolderId != null -> Box(belowHeader) {
            EmptyState(
                icon = Icons.Outlined.Lock,
                title = "This folder is private",
                description = "Enter your account password to open it.",
                actionLabel = "Unlock",
                onAction = { viewModel.unlocker.request(state.lockedFolderId, state.folder?.name) },
            )
        }
        state.error != null && state.documents.isEmpty() -> Box(belowHeader) {
            ErrorState(message = state.error, onRetry = { viewModel.refresh(initial = true) })
        }
        else -> {
            val pagerState = rememberPagerState(initialPage = state.tab.ordinal) { BrowseTab.entries.size }
            SyncPagerWithTab(pagerState, state.tab, onSettled = viewModel::selectTab)
            ShowHeaderWhenTabIsAtTop(pagerState.settledPage, listStates, scrollBehavior)
            BrowsePager(
                pagerState = pagerState,
                feed = PagerFeed(
                    state = state,
                    listStates = listStates,
                    contentPadding = contentPadding,
                    layout = layout,
                    actions = actions,
                    inFolder = inFolder,
                    focusedId = focusedId,
                    onFocusConsumed = viewModel::clearFocusedDocument,
                    onLoadMore = viewModel::loadMore,
                    onHeading = onHeading,
                    onUpload = onUpload,
                ),
            )
        }
    }
}

/** One list state per tab, kept above the pager so a tab remembers its scroll while it is off screen. */
@Composable
private fun rememberTabListStates(): Map<BrowseTab, LazyListState> =
    BrowseTab.entries.associateWith { rememberLazyListState() }

/**
 * A tab that is scrolled to its top has nothing to hide behind, so landing on one brings the
 * header back even if the tab left behind had hidden it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShowHeaderWhenTabIsAtTop(
    settledPage: Int,
    listStates: Map<BrowseTab, LazyListState>,
    scrollBehavior: TopAppBarScrollBehavior,
) {
    LaunchedEffect(settledPage) {
        val list = listStates.getValue(BrowseTab.entries[settledPage])
        if (list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset == 0) {
            scrollBehavior.state.heightOffset = 0f
        }
    }
}

/**
 * Drives the shell's bottom-bar visibility off the header's state, so both bars move in lockstep and
 * the bottom bar reappears at the top. Honored only when the setting is on.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BottomBarFollowsHeader(scrollBehavior: TopAppBarScrollBehavior) {
    val bottomBarScroll = LocalBottomBarScrollState.current
    LaunchedEffect(scrollBehavior, bottomBarScroll) {
        val bar = bottomBarScroll ?: return@LaunchedEffect
        snapshotFlow { scrollBehavior.state.collapsedFraction > 0.5f }
            .distinctUntilChanged()
            .collect { collapsed -> bar.value = !collapsed }
    }
}

private fun titleOf(isFolder: Boolean, state: BrowseUiState): String {
    if (!isFolder) return "My Files"
    return buildString {
        state.folder?.emoji?.let { append("$it  ") }
        append(state.folder?.name ?: "Folder")
    }
}

private fun plural(n: Int): String = if (n == 1) "file" else "files"

private fun downloadStartedMessage(n: Int): String = "Downloading $n ${plural(n)}"
