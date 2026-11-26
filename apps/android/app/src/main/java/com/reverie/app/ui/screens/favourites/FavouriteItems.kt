package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import coil.request.CachePolicy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.domain.CachedFolders
import com.reverie.app.ui.components.DocumentRow
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FileKindBlock
import com.reverie.app.ui.components.FolderRow
import com.reverie.app.ui.components.ROW_PICTURE
import com.reverie.app.ui.components.SelectableTile
import com.reverie.app.ui.components.VideoBadge
import com.reverie.app.ui.navigation.documentSharedBounds

/** A favourite folder, as the folder rows elsewhere. */
@Composable
internal fun FolderFavourite(item: FavouriteDto, folders: CachedFolders, actions: FavouritesActions) {
    if (item.isPrivate) return PrivateFavourite(item, actions)
    val cached = folders.byId[item.id]
    val folder = cached ?: item.folder ?: return
    FolderRow(
        folder = folder,
        cover = if (cached != null) folders.covers[item.id] else folder.cover,
        meta = if (cached != null) folderLine(cached, item) else uncachedFolderLine(item),
        onClick = { actions.selection.tap(item.id) { actions.onOpen(item) } },
        onLongClick = { actions.selection.toggle(item.id) },
        selected = item.id in actions.selection,
    )
}

/** A square of the photo and video grid, [cell] dp wide. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun MediaFavourite(item: FavouriteDto, cell: Float, actions: FavouritesActions) {
    val document = item.document ?: return
    SelectableTile(
        selected = item.id in actions.selection,
        modifier = Modifier
            .size(cell.dp)
            .documentSharedBounds(document.id)
            .combinedClickable(
                onClick = { actions.selection.tap(item.id) { actions.onOpen(item) } },
                onLongClick = { actions.selection.toggle(item.id) },
            ),
    ) {
        DocumentThumbnail(
            documentId = document.id,
            mimeType = document.mime_type,
            filename = document.original_filename,
            blurhash = document.thumbnail_blurhash,
            hasThumbnail = document.hasRenderedThumbnail,
            modifier = Modifier.matchParentSize(),
            size = GRID_THUMBNAIL_SIZE,
            // Favourites never write to disk, so a file that turns private later leaves nothing from here.
            diskCachePolicy = CachePolicy.READ_ONLY,
        )
        if (document.kind == DocumentKind.VIDEO) {
            VideoBadge(document.duration_seconds, Modifier.align(Alignment.TopEnd).padding(6.dp))
        }
    }
}

/** A favourite that is neither a folder nor a picture: a file, or a private document of unknown kind. */
@Composable
internal fun FileFavourite(item: FavouriteDto, actions: FavouritesActions) {
    if (item.isPrivate) return PrivateFavourite(item, actions)
    val document = item.document ?: return
    FavouriteLine(item, fileLine(document, item), actions) { FilePicture(document) }
}

/** A private favourite, folder or file: a padlock, and nothing that says which one it is. */
@Composable
private fun PrivateFavourite(item: FavouriteDto, actions: FavouritesActions) {
    FavouriteLine(item, privateLine(item), actions) { PadlockPicture() }
}

@Composable
private fun PadlockPicture() {
    val tile = Modifier.size(ROW_PICTURE).clip(MaterialTheme.shapes.medium)
    Box(tile.background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun FilePicture(document: DocumentDto) {
    FileKindBlock(document.mime_type, document.original_filename, Modifier.size(ROW_PICTURE).clip(MaterialTheme.shapes.medium))
}

@Composable
private fun FavouriteLine(item: FavouriteDto, meta: String, actions: FavouritesActions, picture: @Composable () -> Unit) {
    DocumentRow(
        name = favouriteName(item),
        meta = meta,
        onClick = { actions.selection.tap(item.id) { actions.onOpen(item) } },
        onLongClick = { actions.selection.toggle(item.id) },
        modifier = Modifier.documentSharedBounds(item.id),
        selected = item.id in actions.selection,
        picture = picture,
    )
}
