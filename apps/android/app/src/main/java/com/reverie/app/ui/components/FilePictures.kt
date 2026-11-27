package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.request.CachePolicy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail

/**
 * A file's picture in a row: the server's picture of it under a badge of its type where [showsPreview] says
 * so, else its type alone. [preview] draws the server's picture into the modifier it is given, so each list
 * loads it by its own rules.
 */
@Composable
internal fun FileRowPicture(
    mimeType: String,
    filename: String,
    hasRendered: Boolean,
    size: Dp = ROW_PICTURE,
    preview: @Composable (Modifier) -> Unit,
) {
    Box(Modifier.size(size)) {
        val picture = Modifier.size(size).clip(MaterialTheme.shapes.medium)
        if (!showsPreview(mimeType, filename, hasRendered)) {
            FileTypeTile(mimeType, filename, picture)
            return@Box
        }
        preview(picture)
        TypeMark(mimeType, filename, overhangingCorner())
    }
}

/** [FileRowPicture] of a listed document. */
@Composable
internal fun FileRowPicture(doc: DocumentDto, size: Dp = ROW_PICTURE, diskCachePolicy: CachePolicy = CachePolicy.ENABLED) {
    FileRowPicture(doc.mime_type, doc.original_filename, doc.hasRenderedThumbnail, size) { picture ->
        DocumentThumbnail(
            documentId = doc.id,
            mimeType = doc.mime_type,
            filename = doc.original_filename,
            blurhash = doc.thumbnail_blurhash,
            hasThumbnail = true,
            modifier = picture,
            diskCachePolicy = diskCachePolicy,
        )
    }
}

/**
 * A file's tile in a grid, filling [modifier]: as [FileRowPicture], with the badge inside the corner.
 * [caption] names a file drawn as its type, for a tile with nothing else naming it.
 */
@Composable
internal fun FileGridTile(
    mimeType: String,
    filename: String,
    hasRendered: Boolean,
    modifier: Modifier = Modifier,
    caption: String? = null,
    preview: @Composable (Modifier) -> Unit,
) {
    Box(modifier) {
        if (!showsPreview(mimeType, filename, hasRendered)) {
            FileTypeTile(mimeType, filename, Modifier.matchParentSize(), 28.dp, caption)
            return@Box
        }
        preview(Modifier.matchParentSize())
        TypeMark(mimeType, filename, Modifier.align(Alignment.BottomEnd).padding(6.dp))
    }
}

/** The round badge naming the type of a file shown as its picture. */
@Composable
private fun TypeMark(mimeType: String, filename: String, modifier: Modifier) {
    val type = fileTypeOf(mimeType, filename)
    CornerBadge(type.icon, fileTypeLabel(mimeType, filename), modifier, tint = type.ink)
}
