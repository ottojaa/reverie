package com.reverie.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
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
) {
    // Google-Photos multi-select: the thumbnail springs slightly smaller with rounded corners,
    // revealing a teal frame, while the check pops in. One `progress` drives all three so select
    // and deselect animate symmetrically.
    val progress by animateFloatAsState(
        targetValue = if (selected) 1f else 0f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMediumLow),
        label = "selection",
    )
    val scale = lerp(1f, 0.86f, progress)
    // Clamp for the corner: the bouncy spring undershoots below 0 on deselect, and a negative
    // corner radius crashes RoundedCornerShape. Scale can keep the (always-positive) overshoot.
    val corner = androidx.compose.ui.unit.lerp(0.dp, 12.dp, progress.coerceIn(0f, 1f))

    Box(
        modifier = modifier
            .documentSharedBounds(document.id)
            .clip(RectangleShape)
            // Muted frame, revealed only as the thumbnail shrinks; fully covered when unselected.
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
    ) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                }
                .clip(RoundedCornerShape(corner)),
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
                locked = document.locked,
                modifier = Modifier.matchParentSize(),
            )
        }

        // Top-start slot: the selection check pops over the private-lock's spot while selecting.
        AnimatedVisibility(
            visible = selected,
            enter = scaleIn(spring(stiffness = Spring.StiffnessMediumLow)) + fadeIn(),
            exit = scaleOut() + fadeOut(),
            modifier = Modifier.align(Alignment.TopStart).padding(6.dp),
        ) {
            SelectedCheck()
        }
        // Locked tiles already render a full lock placeholder, so the corner badge is only for
        // unlocked-but-private items (a subtle "this is private" marker).
        AnimatedVisibility(
            visible = !selected && document.is_private && !document.locked,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopStart).padding(6.dp),
        ) {
            PrivateLockBadge()
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
