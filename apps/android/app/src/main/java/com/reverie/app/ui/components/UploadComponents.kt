package com.reverie.app.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.util.formatBytes
import java.io.File

/** One file row in the upload review sheet. */
@Composable
fun UploadFileRow(
    item: UploadItemEntity,
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center,
        ) {
            if (item.mimeType.startsWith("image/")) {
                AsyncImage(
                    model = File(item.stagedPath),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(40.dp),
                )
            } else {
                Icon(
                    Icons.Outlined.InsertDriveFile,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(item.displayName, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatBytes(item.sizeBytes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        UploadStatusGlyph(status = item.status, progress = item.progress, onRetry = onRetry)
    }
}

@Composable
private fun UploadStatusGlyph(status: String, progress: Int, onRetry: (() -> Unit)?) {
    when (status) {
        "complete" -> Icon(Icons.Filled.CheckCircle, contentDescription = "Uploaded", tint = ReverieTheme.extendedColors.success, modifier = Modifier.size(22.dp))
        "failed" -> if (onRetry != null) {
            IconButton(onClick = onRetry) { Icon(Icons.Outlined.Refresh, contentDescription = "Retry", tint = MaterialTheme.colorScheme.error) }
        } else {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = "Failed", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(22.dp))
        }
        // Determinate while streaming bytes; indeterminate for server-side processing (no byte signal).
        "uploading" -> CircularProgressIndicator(
            progress = { progress.coerceIn(0, 100) / 100f },
            strokeWidth = 2.dp,
            modifier = Modifier.size(18.dp),
        )
        "processing" -> CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        else -> Box(
            modifier = Modifier
                .size(10.dp)
                .background(MaterialTheme.colorScheme.outline, RoundedCornerShape(50)),
        )
    }
}

/** Two-phase overall progress: uploading bytes, then generating previews. */
@Composable
fun TwoPhaseProgressBar(items: List<UploadItemEntity>, modifier: Modifier = Modifier) {
    val total = items.size.coerceAtLeast(1)
    val done = items.count { it.status == "complete" || it.status == "failed" }
    // Continuous fraction: finished files count as 100%, the in-flight file contributes its bytes,
    // so the bar advances smoothly instead of jumping a whole file at a time.
    val accumulated = items.sumOf { item ->
        if (item.status == "complete" || item.status == "failed") 100 else item.progress.coerceIn(0, 100)
    }
    val fraction by animateFloatAsState(accumulated.toFloat() / (total * 100f), animationSpec = androidx.compose.animation.core.tween(200, easing = LinearEasing), label = "upload")
    val allDone = done == items.size

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = if (allDone) "$done of ${items.size} uploaded" else "Uploading… $done of ${items.size}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

/** Docked pill showing active uploads; tap to reopen the review sheet. */
@Composable
fun UploadStatusPill(count: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.primaryContainer)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(16.dp))
        Text(
            "  Uploading $count",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}
