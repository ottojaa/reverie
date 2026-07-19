package com.reverie.app.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.ui.navigation.documentSharedBounds

/**
 * A Google-Photos-style gallery tile: a square, edge-to-edge cropped thumbnail with no caption and
 * no corner radius. Non-media files carry a subtle file-type glyph so they read as documents; media
 * tiles stay clean. Overlays (video/type/selection/private badges) sit in the corners.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DocumentCard(
    document: DocumentDto,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .documentSharedBounds(document.id)
            .clip(RectangleShape)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .then(
                if (selected) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RectangleShape) else Modifier,
            ),
    ) {
        // Shared tile visual (thumbnail-or-icon + video/type overlays), identical to the search grid.
        GalleryThumbnail(
            documentId = document.id,
            mimeType = document.mime_type,
            filename = document.original_filename,
            blurhash = document.thumbnail_blurhash,
            hasThumbnail = document.hasRenderedThumbnail,
            size = GRID_THUMBNAIL_SIZE,
            durationSeconds = document.duration_seconds,
            modifier = Modifier.matchParentSize(),
        )

        // Top-start slot: the selection check takes over the private-lock's spot while selecting.
        when {
            selected -> SelectedCheck(Modifier.align(Alignment.TopStart).padding(6.dp))
            document.is_private -> PrivateLockBadge(Modifier.align(Alignment.TopStart).padding(6.dp))
        }
    }
}

@Composable
private fun PrivateLockBadge(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(24.dp)
            .background(MaterialTheme.colorScheme.tertiary, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.Lock,
            contentDescription = "Private",
            tint = MaterialTheme.colorScheme.onTertiary,
            modifier = Modifier.size(14.dp),
        )
    }
}

@Composable
private fun SelectedCheck(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(24.dp)
            .background(MaterialTheme.colorScheme.primary, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.Check,
            contentDescription = "Selected",
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(15.dp),
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
