package com.reverie.app.ui.screens.trash

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.reverie.app.data.api.model.TrashDocumentDto
import com.reverie.app.ui.components.CoverIconBlock
import com.reverie.app.ui.components.DocumentRow
import com.reverie.app.ui.components.FileKindBlock
import com.reverie.app.ui.components.ROW_PICTURE
import com.reverie.app.ui.components.rememberBlurhashPainter
import java.time.Instant

/** One item in the trash. It cannot be opened: a tap asks what to do with it, and a hold selects it. */
@Composable
fun TrashRow(
    item: TrashItem,
    now: Instant,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
) {
    DocumentRow(
        name = item.name,
        meta = trashMeta(item, now),
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier,
        selected = selected,
        // A trashed file's name is all there is to tell it by, so its ending stays in view.
        nameOverflow = TextOverflow.MiddleEllipsis,
    ) { TrashPicture(item) }
}

@Composable
private fun TrashPicture(item: TrashItem) {
    when (item) {
        is TrashItem.Document -> DocumentPicture(item.document)
        is TrashItem.Folder -> IconPicture(if (item.folder.locked) Icons.Outlined.Lock else Icons.Outlined.Folder)
    }
}

/**
 * A trashed file's thumbnail, loaded by the address the listing signed (a trashed document has no other)
 * and never written to disk.
 */
@Composable
private fun DocumentPicture(document: TrashDocumentDto) {
    val url = document.thumbnail_urls?.sm
    val picture = Modifier.size(ROW_PICTURE).clip(MaterialTheme.shapes.medium)
    if (url == null) {
        FileKindBlock(document.mime_type, document.original_filename, picture)
        return
    }
    val placeholder = rememberBlurhashPainter(document.thumbnail_blurhash)
    AsyncImage(
        model = ImageRequest.Builder(LocalContext.current).data(url).diskCachePolicy(CachePolicy.DISABLED).build(),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        placeholder = placeholder,
        error = placeholder,
        modifier = picture,
    )
}

@Composable
private fun IconPicture(icon: ImageVector) {
    CoverIconBlock(icon, MaterialTheme.colorScheme.onSurfaceVariant, size = ROW_PICTURE, shape = MaterialTheme.shapes.medium)
}
