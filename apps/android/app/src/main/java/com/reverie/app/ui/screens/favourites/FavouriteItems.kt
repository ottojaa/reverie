package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.request.CachePolicy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.domain.CachedFolders
import com.reverie.app.ui.components.CoverIconBlock
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FavouriteMenuItem
import com.reverie.app.ui.components.FileKindBlock
import com.reverie.app.ui.components.FolderRow
import com.reverie.app.ui.components.VideoBadge
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.screens.browse.ROW_NAME_STYLE

private val PICTURE_SIZE = 52.dp

/**
 * A favourite folder, as the folder rows elsewhere with its menu on a long press. A folder the cached tree
 * does not hold offers only what any favourite does.
 */
@Composable
internal fun FolderFavourite(item: FavouriteDto, folders: CachedFolders, actions: FavouritesActions) {
    if (item.isPrivate) return PrivateFavourite(item, actions)
    val cached = folders.byId[item.id]
    if (cached != null) {
        FolderRow(
            folder = cached,
            cover = folders.covers[item.id],
            meta = folderLine(cached, item),
            onClick = { actions.onOpen(item) },
            onLongClick = { actions.onHoldFolder(cached) },
        )
        return
    }
    val listed = item.folder ?: return
    WithFavouriteMenu(item, actions) { openMenu ->
        FolderRow(listed, listed.cover, uncachedFolderLine(item), onClick = { actions.onOpen(item) }, onLongClick = openMenu)
    }
}

/** A square of the photo and video grid, [cell] dp wide. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun MediaFavourite(item: FavouriteDto, cell: Float, actions: FavouritesActions) {
    val document = item.document ?: return
    WithFavouriteMenu(item, actions) { openMenu ->
        Box(
            Modifier
                .size(cell.dp)
                .documentSharedBounds(document.id)
                .combinedClickable(onClick = { actions.onOpen(item) }, onLongClick = openMenu),
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
}

/** A favourite that is neither a folder nor a picture: a file, or a private document of unknown kind. */
@Composable
internal fun FileFavourite(item: FavouriteDto, actions: FavouritesActions) {
    if (item.isPrivate) return PrivateFavourite(item, actions)
    val document = item.document ?: return
    DocumentLine(item, fileLine(document, item), actions) { FilePicture(document) }
}

/** A private favourite, folder or file: a padlock, and nothing that says which one it is. */
@Composable
private fun PrivateFavourite(item: FavouriteDto, actions: FavouritesActions) {
    DocumentLine(item, privateLine(item), actions) {
        CoverIconBlock(
            icon = Icons.Outlined.Lock,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            size = PICTURE_SIZE,
            shape = MaterialTheme.shapes.medium,
        )
    }
}

@Composable
private fun FilePicture(document: DocumentDto) {
    FileKindBlock(document.mime_type, document.original_filename, Modifier.size(PICTURE_SIZE).clip(MaterialTheme.shapes.medium))
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DocumentLine(item: FavouriteDto, meta: String, actions: FavouritesActions, picture: @Composable () -> Unit) {
    WithFavouriteMenu(item, actions) { openMenu ->
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .documentSharedBounds(item.id)
                .combinedClickable(onClick = { actions.onOpen(item) }, onLongClick = openMenu)
                .heightIn(min = 68.dp)
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            picture()
            Column(Modifier.weight(1f)) {
                Text(favouriteName(item), style = ROW_NAME_STYLE.copy(fontSize = 16.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    meta,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** [content] with the menu a long press on it opens. */
@Composable
private fun WithFavouriteMenu(
    item: FavouriteDto,
    actions: FavouritesActions,
    content: @Composable (openMenu: () -> Unit) -> Unit,
) {
    var isOpen by remember { mutableStateOf(false) }
    Box {
        content { isOpen = true }
        DropdownMenu(expanded = isOpen, onDismissRequest = { isOpen = false }) {
            DropdownMenuItem(
                text = { Text("Open") },
                onClick = {
                    isOpen = false
                    actions.onOpen(item)
                },
            )
            FavouriteMenuItem(isStarred = true) {
                isOpen = false
                actions.onUnstar(item)
            }
        }
    }
}
