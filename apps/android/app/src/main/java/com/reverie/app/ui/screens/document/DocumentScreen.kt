package com.reverie.app.ui.screens.document

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.domain.model.toInsightPhase
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.navigation.aboveSharedElements
import com.reverie.app.ui.navigation.animateViewerChrome
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.InsightSheet
import com.reverie.app.util.enqueueDownload
import kotlinx.coroutines.launch

/**
 * The full-screen document viewer. It hosts a [HorizontalPager] over the ordered sequence handed
 * off by the origin screen (Browse/Search), so the user can swipe between documents Google-Photos
 * style. Each page is a [DocumentPage]; the chrome (toolbar, insights, dialogs) lives here and
 * always acts on the current page's document.
 */
@Composable
fun DocumentScreen(
    documentId: String,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
    aspect: Float? = null,
    viewModel: DocumentViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
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

    var insightOpen by remember { mutableStateOf(false) }
    var immersive by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }
    var showRename by remember { mutableStateOf(false) }

    // Pop when the sequence empties (e.g. the whole folder was deleted while swiping).
    LaunchedEffect(ids) { if (ids.isEmpty()) onBackClick() }

    // On each settle: move the realtime subscription / mark accessed / sync the origin grid, and
    // pull the origin's next page as we approach the tail.
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.settledPage }.collect { page ->
            viewModel.ids.value.getOrNull(page)?.let { viewModel.onPageSettled(it) }
            viewModel.requestMoreIfNeeded(page)
        }
    }

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { _ ->
        Box(Modifier.fillMaxSize()) {
            HorizontalPager(
                state = pagerState,
                // Preload one neighbor each side so a swipe reveals an already-fetched page.
                beyondViewportPageCount = 1,
                key = { ids.getOrNull(it) ?: it.toString() },
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                val pageId = ids.getOrNull(page) ?: return@HorizontalPager
                DocumentPage(
                    id = pageId,
                    // The nav-arg aspect belongs to the entry document only; keyed by id so deletions
                    // that shift indices never mis-apply it.
                    aspectHint = if (pageId == documentId) aspect else null,
                    isCurrentPage = page == pagerState.currentPage,
                    isSettledPage = page == pagerState.settledPage,
                    onToggleImmersive = { immersive = !immersive },
                    viewModel = viewModel,
                )
            }

            // Subtle fade + short vertical slide, rendered above the shared element so it isn't
            // occluded during the container transform.
            AnimatedVisibility(
                visible = !immersive,
                enter = fadeIn(tween(200)) + slideInVertically(tween(200)) { -it / 3 },
                exit = slideOutVertically(tween(150)) { -it / 3 } + fadeOut(tween(150)),
                modifier = Modifier.aboveSharedElements().animateViewerChrome(),
            ) {
                ViewerToolbar(
                    document = document,
                    phase = document?.let(::toInsightPhase) ?: InsightPhase.Idle,
                    insightOpen = insightOpen,
                    menuOpen = menuOpen,
                    onBack = onBackClick,
                    onTitleClick = { if (document != null) insightOpen = true },
                    onEdit = {
                        menuOpen = false
                        scope.launch { snackbarHostState.showSnackbar("Editing is coming soon on Android") }
                    },
                    onDownload = { document?.let { downloadDocument(context, currentFileUrl, it) } },
                    onMenuToggle = { menuOpen = it },
                    onRename = { menuOpen = false; showRename = true },
                    onTogglePrivate = {
                        menuOpen = false
                        document?.let { viewModel.setPrivate(currentId, !it.is_private) }
                    },
                    onDelete = { menuOpen = false; showDelete = true },
                )
            }
        }
    }

    if (insightOpen && document != null) {
        InsightSheet(
            document = document!!,
            isAdmin = isAdmin,
            onRetryOcr = { viewModel.retryOcr(currentId) },
            onReprocessLlm = { viewModel.reprocessLlm(currentId) },
            loadOcr = { viewModel.ocrResult(currentId) },
            onDismiss = { insightOpen = false },
        )
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

internal fun downloadDocument(context: android.content.Context, fileUrl: String?, document: DocumentDto) {
    fileUrl ?: return
    enqueueDownload(context, fileUrl, document.original_filename)
}
