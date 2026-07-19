package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.CollectionSearchResult
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.util.formatShortDate

@Composable
fun SearchResultRow(hit: DocumentSearchResult, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DocumentThumbnail(
            documentId = hit.document_id,
            mimeType = hit.mime_type,
            filename = hit.filename,
            blurhash = hit.blurhash,
            hasThumbnail = !hit.blurhash.isNullOrBlank(),
            size = ThumbnailSize.SM,
            modifier = Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)),
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(hit.display_name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                text = listOfNotNull(
                    hit.folder_path?.trim('/')?.takeIf { it.isNotBlank() },
                    formatShortDate(hit.extracted_date ?: hit.uploaded_at),
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun CollectionResultRow(hit: CollectionSearchResult, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionIcon(emoji = hit.emoji, size = 28.dp)
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
        ) {
            Text(hit.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${hit.document_count} ${if (hit.document_count == 1) "file" else "files"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun DateBucketHeader(label: String, modifier: Modifier = Modifier) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

/**
 * A search grid tile — identical to the Files grid tile: a square, edge-to-edge cropped thumbnail
 * (or a file-type icon when there's no preview) with a video play overlay, and a shared-element
 * container transform into the viewer. `blurhash` is the cache-safe "has a rendered preview" signal.
 */
@Composable
fun PhotoResultTile(hit: DocumentSearchResult, onClick: () -> Unit, modifier: Modifier = Modifier) {
    GalleryThumbnail(
        documentId = hit.document_id,
        mimeType = hit.mime_type,
        filename = hit.filename,
        blurhash = hit.blurhash,
        hasThumbnail = !hit.blurhash.isNullOrBlank(),
        size = ThumbnailSize.MD,
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .documentSharedBounds(hit.document_id)
            .clip(RectangleShape)
            .clickable(onClick = onClick),
    )
}
