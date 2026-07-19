package com.reverie.app.ui.screens.document

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.domain.model.toInsightPhase
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.navigation.aboveSharedElements
import com.reverie.app.ui.navigation.animateViewerChrome
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.DocumentViewerBody
import com.reverie.app.ui.screens.viewer.InsightSheet
import com.reverie.app.ui.screens.viewer.isImageDocument
import com.reverie.app.ui.screens.viewer.viewers.DocumentDiveHero
import com.reverie.app.util.enqueueDownload
import kotlinx.coroutines.launch

@Composable
fun DocumentScreen(
    documentId: String,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
    aspect: Float? = null,
    viewModel: DocumentViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val document = state.document
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var insightOpen by remember { mutableStateOf(false) }
    var immersive by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }
    var showRename by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { _ ->
        Box(Modifier.fillMaxSize()) {
            // The shared container transform expands the tapped grid tile into this box. It's sized
            // to the image's real aspect rect (centered), so a square grid tile grows into an
            // aspect-matched rectangle: Crop fills both ends exactly → the image grows monotonically
            // with NO overshoot, and rests where it started (no jump). Docs with no known aspect
            // (pdf/text, or before the record loads) fall back to a full-screen box.
            BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                // Only images fit themselves into an aspect-matched box: that box is the dive-transform
                // target and letterboxing a photo is correct. PDF/text/video/other viewers get the full
                // screen — their thumbnail-derived width/height must NOT shrink the viewer into a
                // centered band with limited height (default to image bounds until the record loads;
                // BrowseScreen only passes `aspect` for images, so the frame-1 default stays correct).
                val isImage = document?.let(::isImageDocument) ?: true
                // Prefer the aspect passed as a nav arg (known on frame 1, so the shared bounds never
                // change shape mid-transition); fall back to the loaded record's dimensions.
                val effectiveAspect = if (isImage) aspect ?: document?.mediaAspectOrNull() else null
                val screenAspect = maxWidth.value / maxHeight.value
                val heroBounds = when {
                    effectiveAspect == null -> Modifier.fillMaxSize()
                    effectiveAspect >= screenAspect -> Modifier.fillMaxWidth().aspectRatio(effectiveAspect)
                    else -> Modifier.fillMaxHeight().aspectRatio(effectiveAspect, matchHeightConstraintsFirst = true)
                }
                Box(heroBounds.documentSharedBounds(documentId)) {
                    // Base layer: the thumbnail hero drives the whole grow (present from frame 1, so
                    // the shared node never shows a spinner or cross-fade — that was the "flash").
                    // Real content draws on top: for images the zoomable mounts after the transform
                    // settles; the other viewers paint over it.
                    DocumentDiveHero(documentId, Modifier.fillMaxSize())
                    when {
                        document != null -> DocumentViewerBody(
                            document = document,
                            fileUrl = state.fileUrl,
                            loadFile = { viewModel.originalFile() },
                            onToggleImmersive = { immersive = !immersive },
                            onDownload = { downloadDocument(context, state.fileUrl, document) },
                            modifier = Modifier.fillMaxSize(),
                        )
                        state.error != null -> ErrorState(message = state.error!!, onRetry = viewModel::load)
                        else -> Unit
                    }
                }
            }

            // Subtle fade + short vertical slide. The old default (fadeIn + expandIn from the
            // bottom-end) combined with the screen push read as a diagonal fly-in. Rendered above
            // the shared element so it isn't occluded during the container transform.
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
                    onDownload = { document?.let { downloadDocument(context, state.fileUrl, it) } },
                    onMenuToggle = { menuOpen = it },
                    onRename = { menuOpen = false; showRename = true },
                    onTogglePrivate = {
                        menuOpen = false
                        document?.let { viewModel.setPrivate(!it.is_private) }
                    },
                    onDelete = { menuOpen = false; showDelete = true },
                )
            }
        }
    }

    if (insightOpen && document != null) {
        InsightSheet(
            document = document,
            isAdmin = state.isAdmin,
            onRetryOcr = viewModel::retryOcr,
            onReprocessLlm = viewModel::reprocessLlm,
            loadOcr = { viewModel.ocrResult() },
            onDismiss = { insightOpen = false },
        )
    }

    if (showRename && document != null) {
        RenameDialog(
            initial = document.original_filename,
            onConfirm = { viewModel.rename(it); showRename = false },
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
                viewModel.delete(onDeleted = onBackClick)
            },
            onDismiss = { showDelete = false },
        )
    }
}

private fun downloadDocument(context: android.content.Context, fileUrl: String?, document: DocumentDto) {
    fileUrl ?: return
    enqueueDownload(context, fileUrl, document.original_filename)
}
