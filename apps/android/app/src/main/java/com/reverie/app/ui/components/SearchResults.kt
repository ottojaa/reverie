package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.util.formatShortDate

@Composable
fun SearchResultRow(
    hit: DocumentSearchResult,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
) {
    DocumentRow(
        name = hit.display_name,
        meta = listOfNotNull(
            hit.folder_path?.trim('/')?.takeIf { it.isNotBlank() },
            formatShortDate(hit.extracted_date ?: hit.uploaded_at),
        ).joinToString(" · "),
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier,
        selected = selected,
    ) { HitPicture(hit) }
}

@Composable
private fun HitPicture(hit: DocumentSearchResult) {
    val isRendered = !hit.blurhash.isNullOrBlank()
    val thumbnail: @Composable (Modifier) -> Unit = { picture ->
        DocumentThumbnail(
            documentId = hit.document_id,
            mimeType = hit.mime_type,
            filename = hit.filename,
            blurhash = hit.blurhash,
            hasThumbnail = isRendered,
            size = ThumbnailSize.SM,
            modifier = picture,
        )
    }
    if (DocumentKind.of(hit.mime_type) == DocumentKind.FILE) {
        FileRowPicture(hit.mime_type, hit.filename, isRendered, preview = thumbnail)
        return
    }
    thumbnail(Modifier.size(ROW_PICTURE).clip(MaterialTheme.shapes.medium))
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
 * A search grid tile — identical to the document grid tile: a square, edge-to-edge cropped thumbnail
 * (or a file-type icon when there's no preview) with a video play overlay, and a shared-element
 * container transform into the viewer. `blurhash` is the cache-safe "has a rendered preview" signal.
 */
@Composable
fun PhotoResultTile(
    hit: DocumentSearchResult,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onLongClick: (() -> Unit)? = null,
) {
    SelectableTile(
        selected = selected,
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .documentSharedBounds(hit.document_id)
            .clip(RectangleShape)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
    ) {
        GalleryThumbnail(
            documentId = hit.document_id,
            mimeType = hit.mime_type,
            filename = hit.filename,
            blurhash = hit.blurhash,
            hasThumbnail = !hit.blurhash.isNullOrBlank(),
            size = ThumbnailSize.MD,
            durationSeconds = hit.duration_seconds,
            modifier = Modifier.matchParentSize(),
        )
    }
}
