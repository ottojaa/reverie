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
import androidx.compose.material3.CircularProgressIndicator
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
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.domain.model.toInsightPhase
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.navigation.aboveSharedElements
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.DocumentViewerBody
import com.reverie.app.ui.screens.viewer.InsightSheet
import com.reverie.app.util.enqueueDownload
import kotlinx.coroutines.launch

@Composable
fun DocumentScreen(
    documentId: String,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
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
            // The shared container transform expands the tapped grid tile into this box (keyed on
            // the nav-arg id so the match exists on the very first frame, before the doc loads).
            Box(Modifier.fillMaxSize().documentSharedBounds(documentId)) {
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
                    else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
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
                modifier = Modifier.aboveSharedElements(),
            ) {
                ViewerToolbar(
                    document = document,
                    phase = document?.let(::toInsightPhase) ?: InsightPhase.Idle,
                    insightOpen = insightOpen,
                    menuOpen = menuOpen,
                    onBack = onBackClick,
                    onTitleClick = { if (document != null) insightOpen = true },
                    onEdit = { scope.launch { snackbarHostState.showSnackbar("Editing is coming soon on Android") } },
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
