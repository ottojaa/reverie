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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
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
    val isVideo = document.mime_type.startsWith("video/")
    val isImage = document.mime_type.startsWith("image/")

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
        DocumentThumbnail(document = document, size = GRID_THUMBNAIL_SIZE, modifier = Modifier.matchParentSize())

        if (isVideo) VideoPlayBadge(Modifier.align(Alignment.Center))
        // Distinguish non-media files without an extension badge on photos/videos.
        if (!isImage && !isVideo) {
            FileTypeBadge(mime = document.mime_type, modifier = Modifier.align(Alignment.TopEnd).padding(6.dp))
        }
        // Top-start slot: the selection check takes over the private-lock's spot while selecting.
        when {
            selected -> SelectedCheck(Modifier.align(Alignment.TopStart).padding(6.dp))
            document.is_private -> PrivateLockBadge(Modifier.align(Alignment.TopStart).padding(6.dp))
        }
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
