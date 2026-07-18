package com.reverie.app.ui.screens.document

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.domain.model.toInsightPhase
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.ErrorState
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.DocumentViewerBody
import com.reverie.app.ui.screens.viewer.InsightSheet
import com.reverie.app.ui.screens.viewer.InsightTitleBlock
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
                    androidx.compose.material3.CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            }

            AnimatedVisibility(visible = !immersive) {
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

@Composable
private fun ViewerToolbar(
    document: DocumentDto?,
    phase: InsightPhase,
    insightOpen: Boolean,
    menuOpen: Boolean,
    onBack: () -> Unit,
    onTitleClick: () -> Unit,
    onEdit: () -> Unit,
    onDownload: () -> Unit,
    onMenuToggle: (Boolean) -> Unit,
    onRename: () -> Unit,
    onTogglePrivate: () -> Unit,
    onDelete: () -> Unit,
) {
    val canEdit = document != null &&
        (document.mime_type.startsWith("image/") || document.mime_type.startsWith("video/"))

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(
                        MaterialTheme.colorScheme.background.copy(alpha = 0.92f),
                        MaterialTheme.colorScheme.background.copy(alpha = 0f),
                    ),
                ),
            ),
    ) {
        Row(
            modifier = Modifier
                .statusBarsPadding()
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Surface(
                color = androidx.compose.ui.graphics.Color.Transparent,
                onClick = onTitleClick,
                modifier = Modifier.weight(1f),
            ) {
                InsightTitleBlock(
                    filename = document?.original_filename ?: "",
                    phase = phase,
                    idleLabel = document?.let { fileTypeLabel(it.mime_type) } ?: "",
                    expanded = insightOpen,
                    modifier = Modifier.padding(vertical = 6.dp, horizontal = 4.dp),
                )
            }
            if (canEdit) {
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Outlined.Edit,
                        contentDescription = "Edit (coming soon)",
                        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f),
                    )
                }
            }
            IconButton(onClick = onDownload) {
                Icon(Icons.Outlined.Download, contentDescription = "Download")
            }
            IconButton(onClick = { onMenuToggle(true) }) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "More")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { onMenuToggle(false) }) {
                DropdownMenuItem(
                    text = { androidx.compose.material3.Text("Rename") },
                    leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                    onClick = onRename,
                )
                DropdownMenuItem(
                    text = { androidx.compose.material3.Text(if (document?.is_private == true) "Remove from private" else "Make private") },
                    leadingIcon = {
                        Icon(
                            if (document?.is_private == true) Icons.Outlined.LockOpen else Icons.Outlined.Lock,
                            contentDescription = null,
                        )
                    },
                    onClick = onTogglePrivate,
                )
                DropdownMenuItem(
                    text = { androidx.compose.material3.Text("Delete") },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    onClick = onDelete,
                )
            }
        }
    }
}

@Composable
private fun RenameDialog(initial: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { androidx.compose.runtime.mutableStateOf(initial) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { androidx.compose.material3.Text("Rename") },
        text = {
            androidx.compose.material3.OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            androidx.compose.material3.TextButton(
                onClick = { onConfirm(text.trim()) },
                enabled = text.isNotBlank(),
            ) { androidx.compose.material3.Text("Save") }
        },
        dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { androidx.compose.material3.Text("Cancel") } },
    )
}

private fun downloadDocument(context: android.content.Context, fileUrl: String?, document: DocumentDto) {
    fileUrl ?: return
    enqueueDownload(context, fileUrl, document.original_filename)
}

private fun fileTypeLabel(mime: String): String = when {
    mime == "application/pdf" -> "PDF document"
    mime.startsWith("image/") -> "Image"
    mime.startsWith("video/") -> "Video"
    mime.startsWith("text/") || mime == "application/json" -> "Text file"
    else -> "File"
}
