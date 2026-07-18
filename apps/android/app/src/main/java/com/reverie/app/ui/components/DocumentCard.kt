package com.reverie.app.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatShortDate

private val TileShape = RoundedCornerShape(16.dp)

/** A gallery tile: a cropped thumbnail with the filename/size/date laid over a bottom scrim. */
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
    val extension = document.original_filename.substringAfterLast('.', "").uppercase()

    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(4f / 5f)
            .documentSharedBounds(document.id)
            .clip(TileShape)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .then(
                if (selected) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, TileShape) else Modifier,
            ),
    ) {
        DocumentThumbnail(document = document, modifier = Modifier.matchParentSize())

        // A bottom scrim keeps the filename/meta legible over any image — and gives icon-only
        // tiles a caption bar so white text reads in light mode too.
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        0.45f to Color.Transparent,
                        1f to Color.Black.copy(alpha = 0.78f),
                    ),
                ),
        )

        Column(
            Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 9.dp),
        ) {
            Text(
                text = document.original_filename,
                style = MaterialTheme.typography.titleSmall,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "${formatBytes(document.size_bytes)} · ${formatShortDate(document.created_at)}",
                style = MaterialTheme.typography.bodySmall,
                color = Color.White.copy(alpha = 0.72f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (isVideo) VideoPlayBadge(Modifier.align(Alignment.Center))
        if (extension.isNotEmpty() && extension.length <= 4) {
            ExtensionBadge(text = extension, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp))
        }
        // Top-start slot: the selection check takes over the private-lock's spot while selecting.
        when {
            selected -> SelectedCheck(Modifier.align(Alignment.TopStart).padding(8.dp))
            document.is_private -> PrivateLockBadge(Modifier.align(Alignment.TopStart).padding(8.dp))
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

@Composable
private fun ExtensionBadge(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = Color.White,
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/** Placeholder tile shown while the grid loads. */
@Composable
fun DocumentCardSkeleton(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(4f / 5f)
            .clip(TileShape)
            .background(shimmerBrush()),
    )
}
