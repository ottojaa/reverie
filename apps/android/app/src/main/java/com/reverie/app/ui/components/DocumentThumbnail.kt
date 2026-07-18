package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize

/** The thumbnail fill for a document: a cropped image, or a centered type icon when there's none. */
@Composable
fun DocumentThumbnail(
    document: DocumentDto,
    modifier: Modifier = Modifier,
    size: ThumbnailSize = ThumbnailSize.MD,
) {
    val hasThumbnail = document.thumbnail_status == JobStatus.COMPLETE

    Box(
        modifier = modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        if (hasThumbnail) {
            val placeholder = rememberBlurhashPainter(document.thumbnail_blurhash)
            AsyncImage(
                model = ThumbnailRef(document.id, size),
                contentDescription = document.original_filename,
                contentScale = ContentScale.Crop,
                placeholder = placeholder,
                error = placeholder,
                modifier = Modifier.matchParentSize(),
            )
        } else {
            Icon(
                imageVector = iconFor(document.mime_type),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(40.dp),
            )
        }
    }
}

private fun iconFor(mime: String): ImageVector = when {
    mime.startsWith("image/") -> Icons.Outlined.Image
    mime.startsWith("video/") -> Icons.Outlined.Movie
    mime == "application/pdf" -> Icons.Outlined.PictureAsPdf
    mime.startsWith("text/") -> Icons.Outlined.Description
    else -> Icons.Outlined.InsertDriveFile
}
