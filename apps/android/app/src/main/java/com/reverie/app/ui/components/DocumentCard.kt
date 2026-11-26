package com.reverie.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.navigation.documentSharedBounds

/**
 * A Google-Photos-style gallery tile: an edge-to-edge cropped thumbnail with no caption and no
 * corner radius. Non-media files carry a file-type icon + name so they read as documents; media
 * tiles stay clean. Overlays (video/type/selection/private badges) sit in the corners. The caller
 * sizes the tile via [modifier] (the justified grid passes an explicit width/height), so this
 * composable no longer forces a square.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DocumentCard(
    document: DocumentDto,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    // Larger mosaic tiles (2×2, 3×2, …) need a bigger source or the MD thumbnail visibly upscales.
    thumbnailSize: ThumbnailSize = GRID_THUMBNAIL_SIZE,
    isStarred: Boolean = false,
) {
    SelectableTile(
        selected = selected,
        modifier = modifier
            .documentSharedBounds(document.id)
            .clip(RectangleShape)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        overlay = {
            // A subtle "this is private" marker for documents inside an open private folder.
            AnimatedVisibility(
                visible = !selected && document.is_private,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.TopStart).padding(6.dp),
            ) {
                PrivateLockBadge()
            }
        },
    ) {
        // Shared tile visual (thumbnail-or-icon + video/type overlays), identical to the search grid.
        GalleryThumbnail(
            documentId = document.id,
            mimeType = document.mime_type,
            filename = document.original_filename,
            blurhash = document.thumbnail_blurhash,
            hasThumbnail = document.hasRenderedThumbnail,
            size = thumbnailSize,
            durationSeconds = document.duration_seconds,
            isStarred = isStarred,
            modifier = Modifier.matchParentSize(),
        )
    }
}

@Composable
internal fun PrivateLockBadge(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(24.dp)
            .background(ON_PICTURE_SCRIM, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Lock,
            contentDescription = "Private",
            tint = Color.White,
            modifier = Modifier.size(14.dp),
        )
    }
}

/** Placeholder tile shown while the grid loads. */
@Composable
fun DocumentCardSkeleton(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(RectangleShape)
            .background(shimmerBrush()),
    )
}
