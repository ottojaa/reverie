package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.util.formatDuration

/**
 * The thumbnail fill for a document: a cropped image, or a centered file-type icon when there's no
 * rendered preview. Primitive overload so callers backed by a [DocumentDto] AND by a search result
 * (which is a different DTO) can share one implementation.
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
    Box(
        modifier = modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        if (hasThumbnail) {
            val placeholder = rememberBlurhashPainter(blurhash)
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
        } else {
            val visual = fileTypeVisual(mimeType, filename)
            Icon(
                imageVector = visual.icon,
                contentDescription = null,
                tint = visual.tint,
                modifier = Modifier.size(40.dp),
            )
        }
    }
}

/**
 * A gallery tile's full visual: the [DocumentThumbnail] fill plus the overlays that let file types
 * read at a glance — a centered play badge on videos and a subtle corner glyph on non-media files.
 * Shared by the Files grid ([DocumentCard]) and the Search grid so both distinguish types identically.
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
        // Distinguish non-media files without an extension badge on photos/videos.
        if (!isImage && !isVideo) {
            FileTypeBadge(mime = mimeType, modifier = Modifier.align(Alignment.TopEnd).padding(6.dp))
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

/** Subtle corner glyph marking a non-media file's type, so documents stand out in the photo grid. */
@Composable
private fun FileTypeBadge(mime: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
            .padding(4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = fileTypeIcon(mime),
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(14.dp),
        )
    }
}

private fun fileTypeIcon(mime: String): ImageVector = when {
    mime == "application/pdf" -> Icons.Outlined.PictureAsPdf
    mime.startsWith("text/") || mime == "application/json" -> Icons.Outlined.Description
    else -> Icons.Outlined.InsertDriveFile
}
