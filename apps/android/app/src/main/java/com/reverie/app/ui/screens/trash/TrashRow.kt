package com.reverie.app.ui.screens.trash

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.reverie.app.data.api.model.TrashDocumentDto
import com.reverie.app.ui.components.CoverIconBlock
import com.reverie.app.ui.components.FileKindBlock
import com.reverie.app.ui.components.rememberBlurhashPainter
import java.time.Instant

private val PICTURE_SIZE = 52.dp

/** One item in the trash. It cannot be opened, so a tap and a hold both ask what to do with it. */
@Composable
fun TrashRow(item: TrashItem, now: Instant, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onClick)
            .heightIn(min = PICTURE_SIZE + 18.dp)
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        TrashPicture(item)
        Column(Modifier.weight(1f)) {
            Text(
                item.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
            )
            Text(
                trashMeta(item, now),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (item is TrashItem.Folder && item.folder.locked) return@Row
        Icon(
            Icons.Outlined.MoreVert,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(18.dp),
        )
    }
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
    val picture = Modifier.size(PICTURE_SIZE).clip(MaterialTheme.shapes.medium)
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
    CoverIconBlock(icon, MaterialTheme.colorScheme.onSurfaceVariant, size = PICTURE_SIZE, shape = MaterialTheme.shapes.medium)
}
