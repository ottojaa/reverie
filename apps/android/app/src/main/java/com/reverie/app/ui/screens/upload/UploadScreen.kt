package com.reverie.app.ui.screens.upload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.upload.HashProgress
import com.reverie.app.domain.upload.NameStrategy
import com.reverie.app.ui.components.FullScreenDialog
import com.reverie.app.ui.screens.destination.DestinationPickerDialog

/** The upload screen over the current screen, for as long as there are files under review. */
@Composable
fun UploadDialog(viewModel: UploadViewModel) {
    val review by viewModel.review.collectAsStateWithLifecycle()
    val state = review ?: return

    FullScreenDialog(onBack = viewModel::dismiss) {
        UploadScreenContent(
            state = state,
            onClose = viewModel::dismiss,
            onUpload = viewModel::upload,
            onPickLocation = viewModel::pickLocation,
            onUploadAnyway = viewModel::setUploadAnyway,
            onStrategy = viewModel::setNameStrategy,
        )
    }
    DestinationPickerDialog(viewModel.destinations, onSelect = viewModel::setLocation)
}

/** The picked files with what the check found about them, where they go, and Upload in the top bar. */
@Composable
fun UploadScreenContent(
    state: ReviewState,
    onClose: () -> Unit,
    onUpload: () -> Unit,
    onPickLocation: () -> Unit,
    onUploadAnyway: (index: Int, upload: Boolean) -> Unit,
    onStrategy: (NameStrategy) -> Unit,
    modifier: Modifier = Modifier,
) {
    val list = rememberLazyListState()
    // The findings are explained above the files, so show them from the top.
    LaunchedEffect(state.findings.isNotEmpty()) { if (state.findings.isNotEmpty()) list.scrollToItem(0) }
    val findings = state.findings.associateBy { it.index }

    Column(modifier.fillMaxSize()) {
        UploadHeader(state, onClose, onUpload)
        LazyColumn(state = list, contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp)) {
            item { UploadStatus(state) }
            itemsIndexed(state.files) { index, file ->
                UploadFileRow(
                    file = file,
                    finding = findings[index],
                    folderName = state.folderName,
                    uploadAnyway = index in state.uploadAnyway,
                    onUploadAnyway = { onUploadAnyway(index, it) },
                    isFirst = index == 0,
                    isLast = index == state.files.lastIndex,
                )
            }
            if (state.asksStrategy) item { StrategyChoice(state.nameStrategy, onStrategy) }
            item { LocationField(state, onPickLocation) }
        }
    }
}

@Composable
private fun UploadHeader(state: ReviewState, onClose: () -> Unit, onUpload: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(start = 8.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onClose, enabled = !state.isStarting) {
            Icon(Icons.Outlined.Close, contentDescription = "Cancel upload")
        }
        Text(
            "Upload",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f).padding(start = 4.dp),
        )
        Button(onClick = onUpload, enabled = !state.isBusy) { Text(toUploadLabel(state)) }
    }
}

private fun toUploadLabel(state: ReviewState): String = when {
    state.findings.isEmpty() -> "Upload"
    state.kept.isEmpty() -> "Skip all"
    else -> "Upload ${state.kept.size}"
}

/** What sits above the files: how much there is, then the check's progress or what it found. */
@Composable
private fun UploadStatus(state: ReviewState) {
    Column(Modifier.padding(bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        state.error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
        if (state.findings.isNotEmpty()) FindingsSummary(state)
        Text(
            toSelectionSummary(state.files),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        state.checking?.let { CheckingProgress(it) }
        if (state.isStarting) LinearProgressIndicator(Modifier.fillMaxWidth())
    }
}

/** Shown while the picked files are hashed and checked, before anything is staged. */
@Composable
private fun CheckingProgress(progress: HashProgress) {
    val shown = (progress.filesDone + 1).coerceAtMost(progress.filesTotal)
    Text("Checking files… $shown of ${progress.filesTotal}", style = MaterialTheme.typography.bodyMedium)
    LinearProgressIndicator(progress = { progress.fraction }, modifier = Modifier.fillMaxWidth())
}
