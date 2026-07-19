package com.reverie.app.ui.screens.viewer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentOcrResult
import com.reverie.app.data.api.model.JobStatus

/**
 * Admin-only per-stage processing status with retry/regenerate actions and raw OCR access. The
 * section header is supplied by the enclosing [com.reverie.app.ui.components.ExpandableSection];
 * this renders the content only.
 */
@Composable
fun ProcessingFooter(
    document: DocumentDto,
    onRetryOcr: () -> Unit,
    onReprocessLlm: () -> Unit,
    loadOcr: suspend () -> DocumentOcrResult,
) {
    var showOcr by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        StageRow("OCR", ocrLabel(document.ocr_status), document.ocr_status)
        StageRow("Insights", llmLabel(document.llm_status), document.llm_status)
        StageRow("Thumbnail", thumbnailLabel(document.thumbnail_status), document.thumbnail_status)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onRetryOcr) { Text("Retry OCR") }
            TextButton(onClick = onReprocessLlm) { Text("Regenerate") }
            TextButton(onClick = { showOcr = true }) { Text("Extracted text") }
        }
    }

    if (showOcr) {
        OcrResultDialog(loadOcr = loadOcr, onDismiss = { showOcr = false })
    }
}

/** One-line status summary for the collapsed Processing accordion header. */
fun processingSummary(document: DocumentDto): String {
    val statuses = listOf(document.ocr_status, document.llm_status, document.thumbnail_status)
    val failed = statuses.count { it == JobStatus.FAILED }
    val active = statuses.count { it == JobStatus.PENDING || it == JobStatus.PROCESSING }
    return when {
        failed > 0 -> "$failed ${if (failed == 1) "stage" else "stages"} failed"
        active > 0 -> "Processing…"
        else -> "All stages complete"
    }
}

@Composable
private fun StageRow(name: String, status: String, jobStatus: JobStatus) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(statusColor(jobStatus), CircleShape),
        )
        Text(
            "  $name",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f).padding(start = 4.dp),
        )
        Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun statusColor(status: JobStatus) = when (status) {
    JobStatus.COMPLETE -> com.reverie.app.ui.theme.ReverieTheme.extendedColors.success
    JobStatus.FAILED -> MaterialTheme.colorScheme.error
    JobStatus.PROCESSING, JobStatus.PENDING -> com.reverie.app.ui.theme.ReverieTheme.extendedColors.warning
    JobStatus.SKIPPED -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
private fun OcrResultDialog(loadOcr: suspend () -> DocumentOcrResult, onDismiss: () -> Unit) {
    var result by remember { mutableStateOf<DocumentOcrResult?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        runCatching { loadOcr() }.onSuccess { result = it }.onFailure { failed = true }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        title = { Text("Extracted text") },
        text = {
            when {
                failed -> Text("Couldn't load OCR text.")
                result == null -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                else -> Column(Modifier.verticalScroll(rememberScrollState())) {
                    val r = result!!
                    Text(
                        "Confidence ${r.confidence_score?.let { "%.0f%%".format(it * 100) } ?: "—"} · " +
                            "${if (r.has_meaningful_text) "meaningful" else "sparse"} text",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = r.raw_text.take(20_000),
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
        },
    )
}

private fun ocrLabel(s: JobStatus) = when (s) {
    JobStatus.COMPLETE -> "Text extracted"
    JobStatus.PROCESSING -> "Extracting text…"
    JobStatus.PENDING -> "Queued"
    JobStatus.FAILED -> "Extraction failed"
    JobStatus.SKIPPED -> "Skipped"
}

private fun llmLabel(s: JobStatus) = when (s) {
    JobStatus.COMPLETE -> "Insights generated"
    JobStatus.PROCESSING -> "Generating insights…"
    JobStatus.PENDING -> "Queued"
    JobStatus.FAILED -> "Generation failed"
    JobStatus.SKIPPED -> "Skipped"
}

private fun thumbnailLabel(s: JobStatus) = when (s) {
    JobStatus.COMPLETE -> "Preview ready"
    JobStatus.PROCESSING -> "Generating preview…"
    JobStatus.PENDING -> "Queued"
    JobStatus.FAILED -> "Preview failed"
    JobStatus.SKIPPED -> "Skipped"
}
