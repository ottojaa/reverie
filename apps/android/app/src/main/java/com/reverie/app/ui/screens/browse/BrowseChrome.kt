package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.domain.counted
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.components.OfflineBanner
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.components.UnlockSheetHost
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.favourites.FavouriteHost
import com.reverie.app.ui.screens.favourites.ReverieSnackbarHost
import com.reverie.app.ui.screens.manage.ManageController
import com.reverie.app.ui.screens.manage.ManageHost
import com.reverie.app.ui.screens.manage.Picked
import com.reverie.app.ui.screens.manage.PickedSelection
import com.reverie.app.ui.screens.manage.Selection
import com.reverie.app.ui.screens.upload.UploadActionSheet
import com.reverie.app.ui.screens.upload.UploadDialog
import com.reverie.app.ui.screens.upload.UploadProgressBar
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.util.enqueueDownload
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.roundToInt

/** What [BrowseChrome] hands the body it wraps: where to sit, how far to inset, and the hooks the body drives the chrome with. */
class ChromeSlot(
    /** Places the body under the header and lets it follow the header as it slides away. */
    val modifier: Modifier,
    val contentPadding: PaddingValues,
    /** Tells the date chip what is at the top of the list; the Library, which has no dates, never calls it. */
    val onTopDate: (TopDate?) -> Unit,
    /** Opens the upload sheet (the empty state's button). */
    val onUpload: () -> Unit,
)

/** What is selected in the body, and the download of it, which the screen's model prepares. */
class ChromeSelection(
    val picked: Picked,
    val selection: Selection,
    val onDownload: (ids: List<String>, onTargets: (List<DownloadTarget>) -> Unit) -> Unit,
)

/**
 * Everything around a Browse list that the Library, a folder page and a list screen share: the header that slides
 * away, the floating date and processing chips, pull-to-refresh, the selection bar, the offline banner,
 * the upload sheets, what the selection bar asks and the unlock prompt for a locked folder.
 * Which list fills the middle is the caller's: [body] gets a [ChromeSlot].
 *
 * @param title null where the list carries its own title.
 * @param isEmpty whether the list has nothing to show, so a load error replaces it.
 * @param headerActions the header's own buttons; they are handed what opens the upload sheet.
 * @param onNewFolder adds "New folder" to the upload sheet.
 * @param notices messages of the screen's own for the snackbar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowseChrome(
    title: BrowseTitle?,
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
    manage: ManageController,
    modifier: Modifier = Modifier,
    headerActions: @Composable (openUpload: () -> Unit) -> Unit = {},
    onNewFolder: (() -> Unit)? = null,
    notices: Flow<String> = emptyFlow(),
    body: @Composable (ChromeSlot) -> Unit,
) {
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var showUploadActions by remember { mutableStateOf(false) }
    var showProcessing by remember { mutableStateOf(false) }
    LaunchedEffect(notices) { notices.collect { snackbarHostState.showSnackbar(it) } }

    // The header slides away on scroll down and returns on a small scroll up. No bar is placed, so
    // the limit is the header's own measured height, set below.
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    BottomBarFollowsHeader(scrollBehavior)

    var topDate by remember { mutableStateOf<TopDate?>(null) }
    var headerPx by remember { mutableIntStateOf(0) }
    LaunchedEffect(headerPx) { scrollBehavior.state.heightOffsetLimit = -headerPx.toFloat() }
    val density = LocalDensity.current
    val statusPx = WindowInsets.statusBars.getTop(density)
    // The banner never rises above the chips' row.
    val chipsPx = statusPx + with(density) { (CHIP_HEIGHT + CHIP_GAP * 2).roundToPx() }
    val inSelection = !selection.picked.isEmpty

    // Pull-to-refresh wraps the whole Scaffold so its indicator floats over the header.
    ReverieRefreshBox(isRefreshing = isRefreshing, onRefresh = onRefresh, modifier = modifier) {
        Scaffold(
            modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            snackbarHost = { ReverieSnackbarHost(snackbarHostState) },
        ) {
            Box(Modifier.fillMaxSize()) {
                val slot = ChromeSlot(
                    modifier = Modifier.belowHeader(headerPx = { headerPx }, heightOffset = { scrollBehavior.state.heightOffset }),
                    contentPadding = PaddingValues(bottom = bottomBarInset() + 12.dp),
                    onTopDate = { topDate = it },
                    onUpload = { showUploadActions = true },
                )
                BodyOrState(ui, isEmpty, unlocker, onRetry, slot, body)
                // Under the header: it is revealed as the header slides up and fades in with it.
                val headerBelowStatusBar = {
                    max(0, headerPx + scrollBehavior.state.heightOffset.roundToInt() - statusPx)
                }
                ScrollChips(
                    topDate = topDate,
                    // The offline banner sits where a date over photos would, so then the date waits its turn.
                    dateBelow = headerBelowStatusBar.takeUnless { ui.isOffline },
                    processingCount = ui.processingCount,
                    onProcessingClick = { showProcessing = true },
                    visibility = { scrollBehavior.state.collapsedFraction },
                    modifier = Modifier.align(Alignment.TopCenter),
                )
                BrowseHeader(
                    title = title,
                    processingCount = ui.processingCount,
                    onProcessingClick = { showProcessing = true },
                    onBack = onBack,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .onSizeChanged { headerPx = it.height }
                        .graphicsLayer { translationY = scrollBehavior.state.heightOffset },
                    actions = { headerActions { showUploadActions = true } },
                )

                // Selection bar overlays the header (opaque) so entering selection never moves the list.
                PickedSelection(
                    picked = selection.picked,
                    selection = selection.selection,
                    manage = manage,
                    modifier = Modifier.align(Alignment.TopCenter),
                    onDownload = { ids ->
                        selection.onDownload(ids) { targets ->
                            targets.forEach { enqueueDownload(context, it.url, it.filename) }
                            if (targets.isNotEmpty()) {
                                scope.launch { snackbarHostState.showSnackbar(downloadStartedMessage(targets.size)) }
                            }
                        }
                    },
                )

                // Rides the header's bottom edge, but never rises above the chips' row.
                OfflineBanner(
                    visible = ui.isOffline && !inSelection,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .offset { IntOffset(0, max(headerPx + scrollBehavior.state.heightOffset.roundToInt(), chipsPx)) },
                )

                UploadProgressBar(
                    viewModel = uploadViewModel,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(start = 16.dp, end = 16.dp, bottom = bottomBarInset() + 16.dp),
                )
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
            onNewFolder = onNewFolder,
        )
    }
    UploadDialog(uploadViewModel)

    if (showProcessing) {
        ProcessingSheet(
            onOpenDocument = { document ->
                showProcessing = false
                onOpenDocument(document)
            },
            onDismiss = { showProcessing = false },
        )
    }

    ManageHost(manage, snackbarHostState)
    UnlockSheetHost(unlocker)
    FavouriteHost(favourites, snackbarHostState)
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
            description = toLockedDescription(ui.lockAsk),
            actionLabel = "Unlock",
            onAction = { unlocker.request(ui.lockedFolderId, ui.folder?.name) },
        )
        ui.error != null && ui.replacesList(isEmpty) -> ErrorState(message = ui.error, onRetry = onRetry)
        // The body sits where the chrome put it already: it must not be placed under the header twice.
        else -> body(ChromeSlot(Modifier, slot.contentPadding, slot.onTopDate, slot.onUpload))
    }
}

internal fun toLockedDescription(ask: LockAsk?): String = when (ask) {
    LockAsk.PIN -> "Enter your PIN to open it."
    LockAsk.PASSWORD -> "Enter your lock password to open it."
    LockAsk.ACCOUNT_PASSWORD -> "Enter your account password to open it."
    null -> "Unlock it to see what is inside."
}

private fun downloadStartedMessage(n: Int): String = "Downloading ${counted(n, "file")}"
