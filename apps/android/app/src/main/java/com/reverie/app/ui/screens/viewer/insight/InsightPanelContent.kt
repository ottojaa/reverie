package com.reverie.app.ui.screens.viewer.insight

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentCategory
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentOcrResult
import com.reverie.app.data.api.model.DocumentPhotoMetadata
import com.reverie.app.domain.model.LlmMetadata
import com.reverie.app.domain.model.formatCategory
import com.reverie.app.domain.model.isFallbackLlmMetadata
import com.reverie.app.ui.components.ExpandableSection
import com.reverie.app.ui.components.LocationMapCard
import com.reverie.app.ui.screens.viewer.ProcessingFooter
import com.reverie.app.ui.screens.viewer.processingSummary

/**
 * The AI-first document details, hosted by whatever container reveals it (a swipe-up pane or a
 * bottom sheet). This composable does no scrolling and applies no navigation-bar insets — the host
 * owns both. Order: AI summary (hero, card-less) → location/map → file facts → mentions & topics
 * (collapsed) → processing (admin, collapsed).
 */
@Composable
fun InsightPanelContent(
    document: DocumentDto,
    isAdmin: Boolean,
    onRetryOcr: () -> Unit,
    onReprocessLlm: () -> Unit,
    loadOcr: suspend () -> DocumentOcrResult,
    modifier: Modifier = Modifier,
) {
    // A fallback llm_metadata record is a truncated OCR preview, not real insights — never present
    // it as AI output (mirrors the web insight panel).
    val isFallback = isFallbackLlmMetadata(document.llm_metadata)
    val metadata = if (isFallback) null else LlmMetadata.from(document.llm_metadata)
    val summary = if (isFallback) null else document.llm_summary

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 16.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        val aiTitle = metadata?.title?.takeIf { it.isNotBlank() }
        InsightSummarySection(
            title = aiTitle ?: fallbackTitle(document),
            category = document.document_category,
            summary = summary,
            aiGenerated = summary != null || aiTitle != null,
        )

        LocationSection(document.photo_metadata)

        InsightFactsSection(document)

        InsightTagsSection(metadata)

        if (isAdmin) {
            ExpandableSection(
                title = "Processing",
                subtitle = processingSummary(document),
                leadingIcon = Icons.Outlined.Memory,
            ) {
                ProcessingFooter(
                    document = document,
                    onRetryOcr = onRetryOcr,
                    onReprocessLlm = onReprocessLlm,
                    loadOcr = loadOcr,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun InsightSummarySection(
    title: String,
    category: DocumentCategory?,
    summary: String?,
    aiGenerated: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // The sparkle marks AI-authored content; omit it when there's no summary/title to
            // attribute (e.g. a scenery photo we deliberately don't summarise).
            if (aiGenerated) {
                Icon(
                    Icons.Outlined.AutoAwesome,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        if (category != null) {
            CategoryChip(formatCategory(category.wire))
        }
        // No "summary coming" placeholder — images without text never get one, so implying it's
        // pending would be wrong. Show the summary only when it actually exists.
        if (summary != null) {
            Text(
                text = summary,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * A sensible title when the LLM produced none: a place name for a located photo (scenery gets
 * "Helsinki, Finland" rather than a camera-roll filename), else the filename, else the category.
 */
private fun fallbackTitle(document: DocumentDto): String {
    val place = listOfNotNull(document.photo_metadata?.city, document.photo_metadata?.country)
        .joinToString(", ")
        .ifBlank { null }
    val isVisual = document.document_category in DocumentCategory.NON_TEXT ||
        document.mime_type.startsWith("image/") ||
        document.mime_type.startsWith("video/")
    if (isVisual && place != null) return place

    val name = document.original_filename.substringBeforeLast('.').trim()
    if (name.isNotBlank()) return name
    return place ?: document.document_category?.let { formatCategory(it.wire) } ?: "Untitled"
}

@Composable
private fun LocationSection(photo: DocumentPhotoMetadata?) {
    if (photo == null) return
    val label = locationLabel(photo) ?: return
    LocationMapCard(latitude = photo.latitude, longitude = photo.longitude, placeName = label)
}

/** "city, country" when present, else formatted coordinates, else null (no card). Ports web toLocationText. */
private fun locationLabel(photo: DocumentPhotoMetadata): String? {
    val place = listOfNotNull(photo.city, photo.country).joinToString(", ").ifBlank { null }
    if (place != null) return place
    val lat = photo.latitude
    val lng = photo.longitude
    if (lat != null && lng != null) return "%.3f°, %.3f°".format(lat, lng)
    return null
}

/** The uppercase, wide-tracked section label (MENTIONS / TOPICS / DETAILS). */
@Composable
internal fun MicroLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The document category, tinted with the brand (primary) container so it stands out. */
@Composable
internal fun CategoryChip(label: String) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onPrimaryContainer,
        modifier = Modifier
            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}
