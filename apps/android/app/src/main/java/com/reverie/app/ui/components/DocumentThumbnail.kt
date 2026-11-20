package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.util.formatDuration

/**
 * The thumbnail fill for a document: a cropped image, or — when there's no rendered preview — a
 * centered file-type icon over a subtle type-colored wash, with the filename beneath it so files
 * with no picture (binaries, archives, .apk, …) are still tellable apart at a glance. Primitive
 * overload so callers backed by a [DocumentDto] AND by a search result (a different DTO) can share
 * one implementation.
 */
@Composable
fun DocumentThumbnail(
    documentId: String,
    mimeType: String,
    filename: String,
    blurhash: String?,
    hasThumbnail: Boolean,
    modifier: Modifier = Modifier,
    size: ThumbnailSize = ThumbnailSize.MD,
) {
    if (hasThumbnail) {
        val placeholder = rememberBlurhashPainter(blurhash)
        Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
            AsyncImage(
                // Explicit memory-cache key so the viewer can reuse this exact decoded bitmap as
                // its placeholder during the container transform (see thumbnailMemoryCacheKey).
                model = ImageRequest.Builder(LocalContext.current)
                    .data(ThumbnailRef(documentId, size))
                    .memoryCacheKey(thumbnailMemoryCacheKey(documentId, size))
                    .build(),
                contentDescription = filename,
                contentScale = ContentScale.Crop,
                placeholder = placeholder,
                error = placeholder,
                modifier = Modifier.matchParentSize(),
            )
        }
        return
    }

    // No picture: a type-colored icon + the filename, on a faint wash of the same accent — mirrors
    // the web preview page, which tints common types so documents don't all read as blank cards.
    val visual = fileTypeVisual(mimeType, filename)
    Column(
        modifier = modifier
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .background(visual.tint.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = visual.icon,
            contentDescription = null,
            tint = visual.tint,
            modifier = Modifier.size(34.dp),
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = filename,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * A gallery tile's full visual: the [DocumentThumbnail] fill plus the overlays that let file types
 * read at a glance — a centered play badge on videos and, for previewable documents, an
 * extension chip in the corner. Shared by the Files grid ([DocumentCard]) and the Search grid.
 */
@Composable
fun GalleryThumbnail(
    documentId: String,
    mimeType: String,
    filename: String,
    blurhash: String?,
    hasThumbnail: Boolean,
    modifier: Modifier = Modifier,
    size: ThumbnailSize = ThumbnailSize.MD,
    durationSeconds: Double? = null,
) {
    val isVideo = mimeType.startsWith("video/")
    val isImage = mimeType.startsWith("image/")
    Box(modifier) {
        DocumentThumbnail(
            documentId = documentId,
            mimeType = mimeType,
            filename = filename,
            blurhash = blurhash,
            hasThumbnail = hasThumbnail,
            size = size,
            modifier = Modifier.matchParentSize(),
        )
        if (isVideo) VideoPlayBadge(Modifier.align(Alignment.Center))
        // A previewable document (a rendered PDF/office page) still needs a type marker; files with
        // no preview already show their icon + name in the fill, so a corner chip would be redundant.
        if (!isImage && !isVideo && hasThumbnail) {
            FileTypeBadge(mime = mimeType, filename = filename, modifier = Modifier.align(Alignment.TopEnd).padding(6.dp))
        }
        // A video's length reads at a glance in the corner, Google-Photos style.
        if (isVideo && durationSeconds != null) {
            DurationPill(seconds = durationSeconds, modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp))
        }
    }
}

/** Bottom-corner `m:ss` pill on video tiles. Shares the FileTypeBadge's scrim styling. */
@Composable
private fun DurationPill(seconds: Double, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
            .padding(horizontal = 5.dp, vertical = 2.dp),
    ) {
        Text(
            text = formatDuration(seconds),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
        )
    }
}

@Composable
private fun VideoPlayBadge(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(44.dp)
            .background(Color.Black.copy(alpha = 0.5f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp))
    }
}

/** Corner chip naming a previewable document's type (e.g. PDF, DOCX) so it stands out in the grid. */
@Composable
private fun FileTypeBadge(mime: String, filename: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(6.dp))
            .padding(horizontal = 5.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = fileTypeLabel(mime, filename),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
        )
    }
}

/** Short uppercase label for a file: its extension when short, else a MIME-derived fallback. */
private fun fileTypeLabel(mime: String, filename: String): String {
    val ext = filename.substringAfterLast('.', "").uppercase()
    if (ext.isNotEmpty() && ext.length <= 4) return ext
    return when {
        mime == "application/pdf" -> "PDF"
        mime == "application/json" -> "JSON"
        mime.startsWith("text/") -> "TXT"
        else -> "FILE"
    }
}
