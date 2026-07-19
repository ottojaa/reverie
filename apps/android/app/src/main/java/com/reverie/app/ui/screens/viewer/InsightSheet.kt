package com.reverie.app.ui.screens.viewer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentOcrResult
import com.reverie.app.domain.model.LlmMetadata
import com.reverie.app.domain.model.formatCategory
import com.reverie.app.domain.model.isFallbackLlmMetadata
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatShortDate

/** The AI-first insight panel: summary, mentions, topics, file facts, and admin processing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InsightSheet(
    document: DocumentDto,
    isAdmin: Boolean,
    onRetryOcr: () -> Unit,
    onReprocessLlm: () -> Unit,
    loadOcr: suspend () -> DocumentOcrResult,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val isFallback = isFallbackLlmMetadata(document.llm_metadata)
    val metadata = if (isFallback) null else LlmMetadata.from(document.llm_metadata)
    val summary = if (isFallback) null else document.llm_summary

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            // Scrollable so long mention/topic lists and details never overflow past the sheet.
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            SummarySection(title = metadata?.title, category = document.document_category?.wire, summary = summary)

            if (metadata != null && metadata.entities.isNotEmpty()) {
                ChipSection(
                    label = "MENTIONS",
                    items = metadata.entities.map { it.canonical_name }.distinct(),
                    primary = true,
                )
            }
            if (metadata != null && metadata.topics.isNotEmpty()) {
                ChipSection(label = "TOPICS", items = metadata.topics, primary = false)
            }

            FileFactsGrid(document)

            if (isAdmin) {
                ProcessingFooter(
                    document = document,
                    onRetryOcr = onRetryOcr,
                    onReprocessLlm = onReprocessLlm,
                    loadOcr = loadOcr,
                )
            }
        }
    }
}

@Composable
private fun SummarySection(title: String?, category: String?, summary: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Outlined.AutoAwesome,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = "  " + (title ?: "Document"),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        if (category != null) {
            CategoryChip(formatCategory(category))
        }
        Text(
            text = summary ?: "No summary available for this document yet.",
            style = MaterialTheme.typography.bodyMedium,
            color = if (summary != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipSection(label: String, items: List<String>, primary: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MicroLabel(label)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items.forEach { item -> CompactChip(text = item, emphasized = primary) }
        }
    }
}

/** A small, dense label pill — far more compact than a Material AssistChip. */
@Composable
private fun CompactChip(text: String, emphasized: Boolean) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = if (emphasized) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .background(
                color = if (emphasized) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainerHigh,
                shape = RoundedCornerShape(8.dp),
            )
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

/** The document category, tinted with the brand (primary) container so it stands out. */
@Composable
private fun CategoryChip(label: String) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = Modifier
            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun FileFactsGrid(document: DocumentDto) {
    val facts = buildList {
        add("Size" to formatBytes(document.size_bytes))
        if (document.width != null && document.height != null) add("Dimensions" to "${document.width}×${document.height}")
        document.extracted_date?.let { add("Document date" to formatShortDate(it)) }
        document.photo_metadata?.taken_at?.let { add("Taken" to formatShortDate(it)) }
        document.photo_metadata?.let { pm ->
            val location = listOfNotNull(pm.city, pm.country).joinToString(", ")
            if (location.isNotBlank()) add("Location" to location)
        }
        add("Uploaded" to formatShortDate(document.created_at))
        add("Modified" to formatShortDate(document.updated_at))
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MicroLabel("DETAILS")
        facts.chunked(2).forEach { rowFacts ->
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.fillMaxWidth()) {
                rowFacts.forEach { (label, value) ->
                    Column(Modifier.weight(1f)) {
                        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(value, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurface)
                    }
                }
                if (rowFacts.size == 1) androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun MicroLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
