package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.CornerBadge
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FileTypeTile
import com.reverie.app.ui.components.ON_PICTURE_SCRIM
import com.reverie.app.ui.components.PrivateLockBadge
import com.reverie.app.ui.components.ROW_PICTURE
import com.reverie.app.ui.components.StarredBadge
import com.reverie.app.ui.components.TilePicture
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.components.fileTypeOf
import com.reverie.app.ui.components.galleryPicture
import com.reverie.app.ui.components.overhangingCorner
import com.reverie.app.ui.components.showsPreview

/**
 * The picture of a document's row on a folder page: its preview, with a play mark on a video and a badge of
 * its type on anything else, or its type alone where there is no preview to show. A private photo or video
 * carries the lock it has on every grid.
 */
@Composable
internal fun DocumentRowPicture(doc: DocumentDto) {
    Box(Modifier.size(ROW_PICTURE)) {
        val picture = Modifier.size(ROW_PICTURE).clip(MaterialTheme.shapes.medium)
        if (doc.showsPreview) {
            MarkedPreview(doc, picture)
        } else {
            FileTypeTile(doc.mime_type, doc.original_filename, picture)
        }
        if (doc.is_private && doc.kind != DocumentKind.FILE) {
            PrivateLockBadge(Modifier.align(Alignment.TopStart).padding(3.dp).size(18.dp))
        }
    }
}

@Composable
private fun BoxScope.MarkedPreview(doc: DocumentDto, picture: Modifier) {
    Preview(doc, ThumbnailSize.MD, picture)
    if (doc.kind == DocumentKind.VIDEO) {
        PlayMark(Modifier.align(Alignment.BottomStart).padding(3.dp))
    } else {
        TypeMark(doc, overhangingCorner())
    }
}

/**
 * A tile of a folder's grid. Photos and videos are drawn as on every grid; other files show their preview
 * under a badge of their type, or their type and name.
 */
internal val folderTilePicture: TilePicture = { doc, size, isStarred ->
    if (doc.kind != DocumentKind.FILE) {
        galleryPicture(doc, size, isStarred)
    } else {
        Box(Modifier.matchParentSize()) {
            if (doc.showsPreview) {
                Preview(doc, size, Modifier.fillMaxSize())
                TypeMark(doc, Modifier.align(Alignment.BottomEnd).padding(6.dp))
            } else {
                FileTypeTile(doc.mime_type, doc.original_filename, Modifier.fillMaxSize(), 28.dp, doc.original_filename)
            }
            if (isStarred) StarredBadge(Modifier.align(Alignment.TopEnd).padding(6.dp))
        }
    }
}

@Composable
private fun Preview(doc: DocumentDto, size: ThumbnailSize, modifier: Modifier) {
    DocumentThumbnail(
        documentId = doc.id,
        mimeType = doc.mime_type,
        filename = doc.original_filename,
        blurhash = doc.thumbnail_blurhash,
        hasThumbnail = true,
        modifier = modifier,
        size = size,
    )
}

@Composable
private fun TypeMark(doc: DocumentDto, modifier: Modifier) {
    val type = fileTypeOf(doc.mime_type, doc.original_filename)
    CornerBadge(type.icon, fileTypeLabel(doc.mime_type, doc.original_filename), modifier, tint = type.ink)
}

/** The play triangle on a video row's picture, small enough to leave the frame to be seen. */
@Composable
private fun PlayMark(modifier: Modifier) {
    Box(modifier.size(18.dp).background(ON_PICTURE_SCRIM, CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.PlayArrow, contentDescription = "Video", tint = Color.White, modifier = Modifier.size(12.dp))
    }
}
