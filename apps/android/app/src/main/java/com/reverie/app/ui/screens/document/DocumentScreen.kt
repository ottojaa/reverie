package com.reverie.app.ui.screens.document

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.domain.model.toInsightPhase
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.navigation.aboveSharedElements
import com.reverie.app.ui.navigation.animateViewerChrome
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.insight.InsightPanelContent
import com.reverie.app.util.enqueueDownload
import com.reverie.app.util.shareDocumentFile
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The full-screen document viewer. It hosts a [HorizontalPager] over the ordered sequence handed
 * off by the origin screen (Browse/Search), so the user can swipe between documents Google-Photos
 * style. Each page is a [DocumentPage]; the chrome (toolbar, action bar, dialogs) lives here.
 *
 * Details open Google-Photos-style: swipe up on the media (or tap Info / the title) and the media
 * shrinks into a top strip while [DocumentDetailsPane] slides up beneath it — all driven by one
 * [DocumentDetailsState].
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DocumentScreen(
    documentId: String,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
    aspect: Float? = null,
    viewModel: DocumentViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val ids by viewModel.ids.collectAsStateWithLifecycle()
    // Correct on frame 1: viewModel.ids exposes the sequence snapshot synchronously, so the pager
    // opens on the tapped document rather than page 0.
    val startIndex = remember { viewModel.ids.value.indexOf(documentId).coerceAtLeast(0) }
    val pagerState = rememberPagerState(initialPage = startIndex) { ids.size }

    val currentId = ids.getOrNull(pagerState.currentPage) ?: documentId
    val document by viewModel.observeDocument(currentId).collectAsStateWithLifecycle(initialValue = null)
    val currentFileUrl by produceState<String?>(initialValue = null, currentId) { value = viewModel.fileUrl(currentId) }
    val isAdmin by viewModel.isAdmin.collectAsStateWithLifecycle()

    val details = rememberDocumentDetailsState()
    var immersive by remember { mutableStateOf(false) }
    var mediaZoomed by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }
    var showRename by remember { mutableStateOf(false) }
    var sharePreparing by remember { mutableStateOf(false) }

    // One place confirms a started download, whichever button triggered it (action bar or the
    // fallback viewer's Download button, which routes through DocumentPage).
    val onDownloadStarted: () -> Unit = { scope.launch { snackbarHostState.showSnackbar("Download started") } }
    val onMediaTap: () -> Unit = { if (details.isOpen) scope.launch { details.close() } else immersive = !immersive }

    // Pop when the sequence empties (e.g. the whole folder was deleted while swiping).
    LaunchedEffect(ids) { if (ids.isEmpty()) onBackClick() }

    // A new page starts unzoomed; drop any stale zoom-hides-chrome state from the previous page.
    LaunchedEffect(currentId) { mediaZoomed = false }

    // On each settle: move the realtime subscription / mark accessed / sync the origin grid, and
    // pull the origin's next page as we approach the tail.
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.settledPage }.collect { page ->
            viewModel.ids.value.getOrNull(page)?.let { viewModel.onPageSettled(it) }
            viewModel.requestMoreIfNeeded(page)
        }
    }

    // Opening details (by any entry point) leaves immersive so the toolbar/strip are visible.
    LaunchedEffect(details.drag.targetValue) {
        if (details.drag.targetValue != DetailsValue.Closed) immersive = false
    }

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { _ ->
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val screenHeightPx = constraints.maxHeight.toFloat()
            val screenWidthPx = constraints.maxWidth.toFloat()
            val headerBottomPx = screenHeightPx * DETAILS_HEADER_FRACTION
            LaunchedEffect(screenHeightPx) {
                details.drag.updateAnchors(
                    DraggableAnchors {
                        DetailsValue.Closed at 0f
                        DetailsValue.Open at -screenHeightPx
                    },
                )
            }
            // How far the media lifts so it sits nicely in the top region when open. Media WIDER than
            // the top region is width-limited within it (short → would leave a gap above the drawer),
            // so it bottom-aligns to the drawer to use that space at full width; taller media centres
            // in the region and may extend under the drawer.
            val mediaAspect = document?.mediaAspectOrNull()
            val regionAspect = if (headerBottomPx > 0f) screenWidthPx / headerBottomPx else 1f
            val peekLiftPx = if (mediaAspect != null && mediaAspect > regionAspect) {
                (screenHeightPx / 2f + (screenWidthPx / mediaAspect) / 2f - headerBottomPx)
                    .coerceIn(0f, headerBottomPx)
            } else {
                screenHeightPx / 2f - headerBottomPx / 2f
            }

            // Media layer: the whole pager, draggable up to open details. Instead of shrinking, the
            // media lifts up out of the way (staying full size — landscape photos keep their width);
            // the drawer's transparent header reveals it, and scrolling the content flows over it.
            Box(
                Modifier
                    .fillMaxSize()
                    // Blocked while zoomed: a pinched image owns its gestures and the drawer stays put.
                    .anchoredDraggable(details.drag, Orientation.Vertical, enabled = !mediaZoomed)
                    .graphicsLayer {
                        translationY = -peekLiftPx * details.fraction
                    },
            ) {
                HorizontalPager(
                    state = pagerState,
                    // Preload one neighbor each side so a swipe reveals an already-fetched page.
                    beyondViewportPageCount = 1,
                    // Lock horizontal paging while details are open — the strip is a details-focused
                    // view of one document.
                    userScrollEnabled = !details.isOpenOrOpening,
                    key = { ids.getOrNull(it) ?: it.toString() },
                    modifier = Modifier.fillMaxSize(),
                ) { page ->
                    val pageId = ids.getOrNull(page) ?: return@HorizontalPager
                    DocumentPage(
                        id = pageId,
                        // The nav-arg aspect belongs to the entry document only; keyed by id so
                        // deletions that shift indices never mis-apply it.
                        aspectHint = if (pageId == documentId) aspect else null,
                        isCurrentPage = page == pagerState.currentPage,
                        isSettledPage = page == pagerState.settledPage,
                        onMediaTap = onMediaTap,
                        onDownloadStarted = onDownloadStarted,
                        detailsOpen = details.isOpenOrOpening,
                        onZoomChanged = { mediaZoomed = it },
                        viewModel = viewModel,
                    )
                }
                // While open, a tap anywhere on the strip closes details (the viewers' own tap
                // handling is disabled via detailsOpen). Drags still reach the anchoredDraggable.
                if (details.isOpenOrOpening) {
                    Box(
                        Modifier
                            .matchParentSize()
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = { scope.launch { details.close() } },
                            ),
                    )
                }
            }

            // Toolbar (top). Hidden in immersive mode and while the image is zoomed; stays visible
            // over the media while details are open.
            AnimatedVisibility(
                visible = !immersive && !mediaZoomed,
                enter = fadeIn(tween(200)) + slideInVertically(tween(200)) { -it / 3 },
                exit = slideOutVertically(tween(150)) { -it / 3 } + fadeOut(tween(150)),
                modifier = Modifier.aboveSharedElements().animateViewerChrome(),
            ) {
                ViewerToolbar(
                    document = document,
                    phase = document?.let(::toInsightPhase) ?: InsightPhase.Idle,
                    detailsOpen = details.isOpenOrOpening,
                    menuOpen = menuOpen,
                    onBack = onBackClick,
                    onTitleClick = {
                        if (document != null) scope.launch { if (details.isOpen) details.close() else details.open() }
                    },
                    onEdit = {
                        menuOpen = false
                        scope.launch { snackbarHostState.showSnackbar("Editing is coming soon on Android") }
                    },
                    onMenuToggle = { menuOpen = it },
                    onRename = { menuOpen = false; showRename = true },
                    onTogglePrivate = {
                        menuOpen = false
                        document?.let { viewModel.setPrivate(currentId, !it.is_private) }
                    },
                )
            }

            // Bottom action bar (Share / Save / Info / Delete). Hidden while zoomed; fades out as the
            // pane rises.
            AnimatedVisibility(
                visible = !immersive && !mediaZoomed,
                enter = fadeIn(tween(200)) + slideInVertically(tween(200)) { it / 3 },
                exit = slideOutVertically(tween(150)) { it / 3 } + fadeOut(tween(150)),
                modifier = Modifier.align(Alignment.BottomCenter).aboveSharedElements(),
            ) {
                ViewerActionBar(
                    modifier = Modifier.graphicsLayer { alpha = 1f - details.fraction },
                    actionsEnabled = !details.isOpenOrOpening,
                    sharePreparing = sharePreparing,
                    onShare = {
                        val doc = document
                        if (doc != null) {
                            scope.launch {
                                sharePreparing = true
                                val file = runCatching { viewModel.originalFile(currentId) }.getOrNull()
                                sharePreparing = false
                                if (file != null) shareDocumentFile(context, file, doc.mime_type, doc.original_filename)
                                else snackbarHostState.showSnackbar("Couldn't prepare this file to share")
                            }
                        }
                    },
                    onDownload = {
                        document?.let { if (downloadDocument(context, currentFileUrl, it)) onDownloadStarted() }
                    },
                    onInfo = { scope.launch { details.open() } },
                    onDelete = { showDelete = true },
                )
            }

            // Details pane, full-screen tall and positioned by the drag offset: fully below the
            // screen when closed, sliding up to full screen when open. Its transparent top region
            // (headerHeight) reveals the lifted media; scrolling the content flows it up over the
            // media to use the whole screen.
            DocumentDetailsPane(
                state = details,
                headerHeight = with(density) { headerBottomPx.toDp() },
                contentMinHeight = with(density) { (screenHeightPx - headerBottomPx).toDp() },
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .offset { IntOffset(0, (screenHeightPx + details.offset).roundToInt()) }
                    .fillMaxWidth()
                    .height(with(density) { screenHeightPx.toDp() }),
            ) {
                document?.let { doc ->
                    InsightPanelContent(
                        document = doc,
                        isAdmin = isAdmin,
                        onRetryOcr = { viewModel.retryOcr(currentId) },
                        onReprocessLlm = { viewModel.reprocessLlm(currentId) },
                        loadOcr = { viewModel.ocrResult(currentId) },
                    )
                }
            }

            // Back collapses details first; only pops the screen once closed.
            BackHandler(enabled = details.isOpenOrOpening) { scope.launch { details.close() } }
        }
    }

    if (showRename && document != null) {
        RenameDialog(
            initial = document!!.original_filename,
            onConfirm = { viewModel.rename(currentId, it); showRename = false },
            onDismiss = { showRename = false },
        )
    }

    if (showDelete) {
        ConfirmDialog(
            title = "Delete this document?",
            message = "It will be permanently deleted — this can't be undone.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                showDelete = false
                // Room-backed sequences shrink themselves (→ pager advances, or the empty-guard pops);
                // the single-doc fallback has no live list, so pop it explicitly.
                viewModel.delete(currentId, onDeleted = { if (viewModel.isFallback) onBackClick() })
            },
            onDismiss = { showDelete = false },
        )
    }
}

/** Enqueue a download; returns false (no-op) when there's no file URL to download yet. */
internal fun downloadDocument(context: android.content.Context, fileUrl: String?, document: DocumentDto): Boolean {
    fileUrl ?: return false
    enqueueDownload(context, fileUrl, document.original_filename)
    return true
}
