package com.reverie.app.ui.screens.upload

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.ui.components.TwoPhaseProgressBar
import com.reverie.app.ui.components.UploadFileRow
import kotlinx.coroutines.delay

/** Hosts the whole review→upload→progress flow, driven by [UploadViewModel.review]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UploadReviewSheet(viewModel: UploadViewModel = hiltViewModel()) {
    val review by viewModel.review.collectAsStateWithLifecycle()
    val folders by viewModel.folders.collectAsStateWithLifecycle()
    val state = review ?: return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var showFolderPicker by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = viewModel::dismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.sessionId == null) {
                ReviewContent(
                    state = state,
                    onPickFolder = { showFolderPicker = true },
                    onUpload = viewModel::requestUpload,
                )
            } else {
                ProgressContent(viewModel = viewModel, sessionId = state.sessionId)
            }
        }
    }

    if (state.duplicates.isNotEmpty() && state.sessionId == null) {
        DuplicateDialog(
            count = state.duplicates.size,
            onReplace = { viewModel.resolveDuplicates("replace") },
            onKeepBoth = { viewModel.resolveDuplicates("keep_both") },
            onCancel = viewModel::dismiss,
        )
    }

    if (showFolderPicker) {
        FolderPickerSheet(
            folders = folders,
            onSelect = { viewModel.setFolder(it.id); showFolderPicker = false },
            onDismiss = { showFolderPicker = false },
        )
    }
}

@Composable
private fun ReviewContent(
    state: ReviewState,
    onPickFolder: () -> Unit,
    onUpload: () -> Unit,
) {
    Text("Upload ${state.uris.size} ${if (state.uris.size == 1) "file" else "files"}", style = MaterialTheme.typography.titleMedium)

    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = RoundedCornerShape(12.dp),
        onClick = onPickFolder,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                text = state.folderName ?: "Choose a folder",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(start = 12.dp).weight(1f),
            )
            Text("Change", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
    }

    Column(
        modifier = Modifier
            .heightIn(max = 280.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        state.fileNames.forEach { name ->
            Row(modifier = Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            }
        }
    }

    Button(
        onClick = onUpload,
        enabled = state.folderId != null,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text("Upload ${state.uris.size} ${if (state.uris.size == 1) "file" else "files"}")
    }
}

@Composable
private fun ProgressContent(viewModel: UploadViewModel, sessionId: String) {
    val items by viewModel.observeItems(sessionId).collectAsStateWithLifecycle(initialValue = emptyList())
    val allDone = items.isNotEmpty() && items.all { it.status == "complete" || it.status == "failed" }
    val allSucceeded = items.isNotEmpty() && items.all { it.status == "complete" }

    LaunchedEffect(allDone) {
        if (allDone) {
            delay(1800)
            viewModel.clearCompleted()
            viewModel.dismiss()
        }
    }

    if (allSucceeded) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = com.reverie.app.ui.theme.ReverieTheme.extendedColors.success)
            Text(
                "  ${items.size} ${if (items.size == 1) "document" else "documents"} uploaded",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
    } else {
        TwoPhaseProgressBar(items = items)
    }

    Column(
        modifier = Modifier
            .heightIn(max = 280.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        items.forEach { item: UploadItemEntity ->
            UploadFileRow(item = item)
        }
    }
}

@Composable
private fun DuplicateDialog(
    count: Int,
    onReplace: () -> Unit,
    onKeepBoth: () -> Unit,
    onCancel: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("$count already ${if (count == 1) "exists" else "exist"}") },
        text = { Text("${if (count == 1) "A file" else "Some files"} with the same name already ${if (count == 1) "exists" else "exist"} in this folder.") },
        confirmButton = { TextButton(onClick = onKeepBoth) { Text("Keep both") } },
        dismissButton = {
            Row {
                TextButton(onClick = onCancel) { Text("Cancel") }
                TextButton(onClick = onReplace) { Text("Replace") }
            }
        },
    )
}
