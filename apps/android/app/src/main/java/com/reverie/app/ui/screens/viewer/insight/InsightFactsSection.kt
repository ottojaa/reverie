package com.reverie.app.ui.screens.viewer.insight

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.components.fileTypeVisual
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatDayDate
import com.reverie.app.util.formatDuration
import com.reverie.app.util.formatRelativeAge
import com.reverie.app.util.formatShortDate
import com.reverie.app.util.formatTimeOfDay
import java.time.Instant

/**
 * The DETAILS card: full-width Google-Photos-style rows (leading icon, primary line, secondary
 * line) instead of the old cramped monospace 2-column grid. Dates lead with the weekday so they're
 * easy to scan; Uploaded folds in relative age and any later modification.
 */
@Composable
fun InsightFactsSection(document: DocumentDto) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        MicroLabel("DETAILS")
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .background(ReverieTheme.cardColor)
                .padding(vertical = 6.dp),
        ) {
            FactRows(document)
        }
    }
}

@Composable
private fun FactRows(document: DocumentDto) {
    val subtle = MaterialTheme.colorScheme.onSurfaceVariant

    document.extracted_date?.let { date ->
        FactRow(Icons.Outlined.CalendarToday, subtle, formatDayDate(date), "Document date · extracted by AI")
    }

    document.photo_metadata?.taken_at?.let { takenAt ->
        val time = formatTimeOfDay(takenAt)
        FactRow(Icons.Outlined.PhotoCamera, subtle, formatDayDate(takenAt), "Taken" + (time?.let { " · $it" } ?: ""))
    }

    val visual = fileTypeVisual(document.mime_type, document.original_filename)
    FactRow(visual.icon, visual.tint, fileTitle(document), fileSubtitle(document))

    FactRow(Icons.Outlined.CloudUpload, subtle, formatDayDate(document.created_at), uploadedSubtitle(document))
}

@Composable
private fun FactRow(icon: ImageVector, iconTint: Color, primary: String, secondary: String?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.size(16.dp))
        Column {
            Text(primary, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
            if (!secondary.isNullOrBlank()) {
                Text(secondary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** "JPG · 3.9 MB" — extension (or a MIME bucket label) then human size. */
private fun fileTitle(document: DocumentDto): String {
    val ext = document.original_filename.substringAfterLast('.', "").uppercase()
    val typeLabel = ext.ifBlank { mimeBucketLabel(document.mime_type) }
    return listOfNotNull(typeLabel.ifBlank { null }, formatBytes(document.size_bytes)).joinToString(" · ")
}

/** "4032 × 3024 px · 1:23" — dimensions and, for videos, duration; null when neither is known. */
private fun fileSubtitle(document: DocumentDto): String? {
    val parts = buildList {
        if (document.width != null && document.height != null) add("${document.width} × ${document.height} px")
        document.duration_seconds?.let { add(formatDuration(it)) }
    }
    return parts.joinToString(" · ").ifBlank { null }
}

/** "Uploaded · 3 days ago · modified Jul 17, 2026" — collapses the old Uploaded + Modified cells. */
private fun uploadedSubtitle(document: DocumentDto): String {
    val parts = buildList {
        add("Uploaded")
        formatRelativeAge(document.created_at)?.let { add(it) }
        if (isMeaningfullyModified(document.created_at, document.updated_at)) {
            add("modified ${formatShortDate(document.updated_at)}")
        }
    }
    return parts.joinToString(" · ")
}

/** True when updated_at is more than a minute past created_at (ignores the write jitter of upload). */
private fun isMeaningfullyModified(created: String, updated: String): Boolean =
    runCatching {
        java.time.Duration.between(Instant.parse(created), Instant.parse(updated)).toMinutes() >= 1
    }.getOrDefault(false)

private fun mimeBucketLabel(mime: String): String = when {
    mime.startsWith("image/") -> "Image"
    mime.startsWith("video/") -> "Video"
    mime.startsWith("audio/") -> "Audio"
    mime.startsWith("text/") -> "Text"
    mime == "application/pdf" -> "PDF"
    else -> "File"
}
