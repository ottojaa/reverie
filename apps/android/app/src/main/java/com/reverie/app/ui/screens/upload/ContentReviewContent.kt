package com.reverie.app.ui.screens.upload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.upload.HashProgress
import com.reverie.app.domain.upload.ContentFinding
import com.reverie.app.domain.upload.NameStrategy
import com.reverie.app.domain.upload.describeContent
import com.reverie.app.domain.upload.describeNameConflict
import com.reverie.app.domain.upload.needsNameChoice
import com.reverie.app.ui.theme.ReverieTheme

/** Shown while the picked files are hashed and checked, before anything is staged. */
@Composable
fun CheckingContent(progress: HashProgress) {
    val shown = (progress.filesDone + 1).coerceAtMost(progress.filesTotal)
    Text("Checking files…", style = MaterialTheme.typography.titleMedium)
    LinearProgressIndicator(progress = { progress.fraction }, modifier = Modifier.fillMaxWidth())
    Text(
        "$shown of ${progress.filesTotal}",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * Lets the person decide on files whose content or name is already in the library. Same choices and
 * wording as the web upload dialog: content matches default to Skip, name clashes get replace / keep both.
 */
@Composable
fun FindingsContent(
    state: ReviewState,
    onUploadAnyway: (index: Int, upload: Boolean) -> Unit,
    onStrategy: (NameStrategy) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val anyContent = state.findings.any { it.hasContentMatch }
    val skipped = state.findings.count { it.hasContentMatch && it.index !in state.uploadAnyway }
    val uploadCount = state.uris.size - skipped
    val asksStrategy = state.findings.any { needsNameChoice(it, it.index in state.uploadAnyway) }

    Text(
        if (anyContent) "Some of these are already in your library" else "Some names are already taken",
        style = MaterialTheme.typography.titleMedium,
    )
    if (anyContent) {
        Text(
            "Skipped files are left out of this upload. You can still upload any of them.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    Column(
        modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        state.findings.forEach { finding ->
            FindingRow(
                finding = finding,
                folderName = state.folderName,
                uploadAnyway = finding.index in state.uploadAnyway,
                onUploadAnyway = { onUploadAnyway(finding.index, it) },
            )
        }
    }

    if (asksStrategy) {
        StrategyChoice(selected = state.nameStrategy, onSelect = onStrategy)
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onCancel) { Text("Cancel") }
        Button(onClick = onConfirm, modifier = Modifier.weight(1f)) {
            Text(if (uploadCount == 0) "Skip all" else "Upload $uploadCount ${if (uploadCount == 1) "file" else "files"}")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FindingRow(finding: ContentFinding, folderName: String?, uploadAnyway: Boolean, onUploadAnyway: (Boolean) -> Unit) {
    val content = finding.result.content
    val found = content?.let { describeContent(it, finding.name) }
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(finding.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (found != null) {
                Text(
                    listOfNotNull(found.label, found.detail).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (finding.result.name_conflict) {
                Text(
                    describeNameConflict(folderName, finding.hasContentMatch),
                    style = MaterialTheme.typography.bodyMedium,
                    color = ReverieTheme.extendedColors.warning,
                )
            }
            if (content != null) {
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
                    SegmentedButton(
                        selected = !uploadAnyway,
                        onClick = { onUploadAnyway(false) },
                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                    ) { Text("Skip") }
                    SegmentedButton(
                        selected = uploadAnyway,
                        onClick = { onUploadAnyway(true) },
                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                    ) { Text("Upload anyway") }
                }
            }
        }
    }
}

@Composable
private fun StrategyChoice(selected: NameStrategy, onSelect: (NameStrategy) -> Unit) {
    Column {
        Text(
            "For files whose name is already taken:",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        StrategyOption("Replace the existing file (it goes to Trash)", selected == NameStrategy.REPLACE) { onSelect(NameStrategy.REPLACE) }
        StrategyOption("Keep both files", selected == NameStrategy.KEEP_BOTH) { onSelect(NameStrategy.KEEP_BOTH) }
    }
}

@Composable
private fun StrategyOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, modifier = Modifier.padding(end = 8.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
