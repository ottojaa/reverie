package com.reverie.app.ui.screens.browse

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.components.ComingSoonSheet
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.components.OfflineBanner
import com.reverie.app.ui.components.ReverieFab
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.components.SelectionTopBar
import com.reverie.app.ui.components.UploadStatusPill
import com.reverie.app.ui.components.VaultUnlockSheet
import com.reverie.app.ui.navigation.LocalBottomBarScrollState
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.favourites.FavouriteHost
import com.reverie.app.ui.screens.favourites.ReverieSnackbarHost
import com.reverie.app.ui.screens.upload.UploadActionSheet
import com.reverie.app.ui.screens.upload.UploadReviewSheet
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.util.enqueueDownload
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.roundToInt

/** What [BrowseChrome] hands the body it wraps: where to sit, how far to inset, and the hooks the body drives the chrome with. */
class ChromeSlot(
    /** Places the body under the header and lets it follow the header as it slides away. */
    val modifier: Modifier,
    val contentPadding: PaddingValues,
    /** Tells the date chip which group is at the top of the list (a kind screen); the dashboard never calls it. */
    val onHeading: (FeedItem.Header?) -> Unit,
    /** Opens the upload sheet (the empty state's button). */
    val onUpload: () -> Unit,
)

/** The selection and what happens to it. */
class ChromeSelection(
    val count: Int,
    val onClear: () -> Unit,
    val onDelete: () -> Unit,
    val onDownload: ((List<DownloadTarget>) -> Unit) -> Unit,
)

/**
 * Everything around a Browse list that the dashboard and a kind screen share: the header that slides
 * away, the floating date and processing chips, pull-to-refresh, the selection bar, the offline banner,
 * the upload button and sheets, the delete confirmation and the password prompt for a locked folder.
 * Which list fills the middle is the caller's: [body] gets a [ChromeSlot].
 *
 * @param isEmpty whether the list has nothing to show, so a load error replaces it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowseChrome(
    title: BrowseTitle,
    ui: SessionUi,
    folderId: String?,
    isRefreshing: Boolean,
    isEmpty: Boolean,
    selection: ChromeSelection,
    unlocker: FolderUnlocker,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    onBack: (() -> Unit)?,
    onOpenDocument: (DocumentDto) -> Unit,
    uploadViewModel: UploadViewModel,
    favourites: FavouriteController,
    modifier: Modifier = Modifier,
    onFavourite: (FavouriteDestination) -> Unit = {},
    body: @Composable (ChromeSlot) -> Unit,
) {
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val activeUploads by uploadViewModel.activeCount.collectAsStateWithLifecycle()
    val review by uploadViewModel.review.collectAsStateWithLifecycle()
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var showCanvasSoon by remember { mutableStateOf(false) }
    var showUploadActions by remember { mutableStateOf(false) }
    var showProcessing by remember { mutableStateOf(false) }
    val unlockPrompt by unlocker.prompt.collectAsStateWithLifecycle()

    // The header slides away on scroll down and returns on a small scroll up. No bar is placed, so
    // the limit is the header's own measured height, set below.
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    BottomBarFollowsHeader(scrollBehavior)

    var heading by remember { mutableStateOf<FeedItem.Header?>(null) }
    var headerPx by remember { mutableIntStateOf(0) }
    LaunchedEffect(headerPx) { scrollBehavior.state.heightOffsetLimit = -headerPx.toFloat() }
    val density = LocalDensity.current
    // The banner never rises above the chips' row.
    val chipsPx = WindowInsets.statusBars.getTop(density) + with(density) { (CHIP_HEIGHT + CHIP_GAP * 2).roundToPx() }
    val inSelection = selection.count > 0

    // Pull-to-refresh wraps the whole Scaffold so its indicator floats over the header.
    ReverieRefreshBox(isRefreshing = isRefreshing, onRefresh = onRefresh, modifier = modifier) {
        Scaffold(
            modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            floatingActionButton = {
                ReverieFab(
                    onClick = { showUploadActions = true },
                    visible = !inSelection,
                    modifier = Modifier.padding(bottom = bottomBarInset()),
                )
            },
            snackbarHost = { ReverieSnackbarHost(snackbarHostState) },
        ) {
            Box(Modifier.fillMaxSize()) {
                val slot = ChromeSlot(
                    modifier = Modifier.belowHeader(headerPx = { headerPx }, heightOffset = { scrollBehavior.state.heightOffset }),
                    contentPadding = PaddingValues(bottom = bottomBarInset() + 12.dp),
                    onHeading = { heading = it },
                    onUpload = { showUploadActions = true },
                )
                BodyOrState(ui, isEmpty, unlocker, onRetry, slot, body)
                // Under the header: it is revealed as the header slides up and fades in with it.
                ScrollChips(
                    heading = heading,
                    processingCount = ui.processingCount,
                    onProcessingClick = { showProcessing = true },
                    visibility = { scrollBehavior.state.collapsedFraction },
                    modifier = Modifier.align(Alignment.TopCenter),
                )
                BrowseHeader(
                    title = title,
                    processingCount = ui.processingCount,
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
                    visible = inSelection,
                    enter = slideInVertically { -it } + fadeIn(),
                    exit = slideOutVertically { -it } + fadeOut(),
                    modifier = Modifier.align(Alignment.TopCenter),
                ) {
                    SelectionTopBar(
                        count = selection.count,
                        onClose = selection.onClear,
                        onDownload = {
                            selection.onDownload { targets ->
                                targets.forEach { enqueueDownload(context, it.url, it.filename) }
                                if (targets.isNotEmpty()) {
                                    scope.launch { snackbarHostState.showSnackbar(downloadStartedMessage(targets.size)) }
                                }
                            }
                        },
                        onDelete = { showDeleteConfirm = true },
                    )
                }

                // Rides the header's bottom edge, but never rises above the chips' row.
                OfflineBanner(
                    visible = ui.isOffline && !inSelection,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .offset { IntOffset(0, max(headerPx + scrollBehavior.state.heightOffset.roundToInt(), chipsPx)) },
                )

                if (activeUploads > 0 && review == null) {
                    UploadStatusPill(
                        count = activeUploads,
                        onClick = { showUploadActions = true },
                        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = bottomBarInset() + 16.dp),
                    )
                }
            }
        }
    }

    if (showUploadActions) {
        UploadActionSheet(
            onFilesPicked = { uris ->
                uploadViewModel.beginReview(uris, folderId)
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
                onOpenDocument(document)
            },
            onDismiss = { showProcessing = false },
        )
    }

    if (showDeleteConfirm) {
        ConfirmDialog(
            title = "Delete ${selection.count} ${plural(selection.count)}?",
            message = "These files will be permanently deleted — this can't be undone.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDeleteConfirm = false
                selection.onDelete()
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
        VaultUnlockSheet(prompt = prompt, onSubmit = unlocker::submit, onDismiss = unlocker::dismiss)
    }
    FavouriteHost(favourites, snackbarHostState, onFavourite)
}

/** The body, or in its place the lock prompt or the load error. */
@Composable
private fun BodyOrState(
    ui: SessionUi,
    isEmpty: Boolean,
    unlocker: FolderUnlocker,
    onRetry: () -> Unit,
    slot: ChromeSlot,
    body: @Composable (ChromeSlot) -> Unit,
) = Box(slot.modifier.fillMaxSize()) {
    when {
        ui.lockedFolderId != null -> EmptyState(
            icon = Icons.Outlined.Lock,
            title = "This folder is private",
            description = "Enter your account password to open it.",
            actionLabel = "Unlock",
            onAction = { unlocker.request(ui.lockedFolderId, ui.folder?.name) },
        )
        ui.error != null && isEmpty -> ErrorState(message = ui.error, onRetry = onRetry)
        // The body sits where the chrome put it already: it must not be placed under the header twice.
        else -> body(ChromeSlot(Modifier, slot.contentPadding, slot.onHeading, slot.onUpload))
    }
}

/**
 * Places the body under the header, following it as it slides away: the body is as tall as the room
 * the header leaves, so a drag that is hiding the header moves the list with the finger. (The scroll
 * behaviour hands the whole drag to the header while it moves; a list with a fixed top gap would stand still.)
 */
internal fun Modifier.belowHeader(headerPx: () -> Int, heightOffset: () -> Float): Modifier = layout { measurable, constraints ->
    val top = (headerPx() + heightOffset()).roundToInt().coerceIn(0, constraints.maxHeight)
    val height = constraints.maxHeight - top
    val placeable = measurable.measure(constraints.copy(minHeight = height, maxHeight = height))
    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(0, top) }
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

fun browseTitleOf(isFolder: Boolean, folder: com.reverie.app.data.api.model.FolderDto?): String {
    if (!isFolder) return "My Files"
    return buildString {
        folder?.emoji?.let { append("$it  ") }
        append(folder?.name ?: "Folder")
    }
}

private fun plural(n: Int): String = if (n == 1) "file" else "files"

private fun downloadStartedMessage(n: Int): String = "Downloading $n ${plural(n)}"
