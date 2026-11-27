package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FileRowPicture
import com.reverie.app.ui.components.ON_PICTURE_SCRIM
import com.reverie.app.ui.components.PrivateLockBadge
import com.reverie.app.ui.components.ROW_PICTURE
import com.reverie.app.ui.components.showsPreview

/**
 * The picture of a document's row on a folder page: a [FileRowPicture], but with a play mark on a video's
 * preview in place of the type badge. A private photo or video carries the lock it has on every grid.
 */
@Composable
internal fun DocumentRowPicture(doc: DocumentDto) {
    Box(Modifier.size(ROW_PICTURE)) {
        if (doc.kind == DocumentKind.VIDEO && doc.showsPreview) {
            VideoPreview(doc)
        } else {
            FileRowPicture(doc)
        }
        if (doc.is_private && doc.kind != DocumentKind.FILE) {
            PrivateLockBadge(Modifier.align(Alignment.TopStart).padding(3.dp).size(18.dp))
        }
    }
}

@Composable
private fun BoxScope.VideoPreview(doc: DocumentDto) {
    DocumentThumbnail(
        documentId = doc.id,
        mimeType = doc.mime_type,
        filename = doc.original_filename,
        blurhash = doc.thumbnail_blurhash,
        hasThumbnail = true,
        modifier = Modifier.size(ROW_PICTURE).clip(MaterialTheme.shapes.medium),
    )
    PlayMark(Modifier.align(Alignment.BottomStart).padding(3.dp))
}

/** The play triangle on a video row's picture, small enough to leave the frame to be seen. */
@Composable
private fun PlayMark(modifier: Modifier) {
    Box(modifier.size(18.dp).background(ON_PICTURE_SCRIM, CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.PlayArrow, contentDescription = "Video", tint = Color.White, modifier = Modifier.size(12.dp))
    }
}
