package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.request.CachePolicy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FileKindBlock
import com.reverie.app.ui.components.ON_PICTURE_SCRIM
import com.reverie.app.ui.components.SectionIcon
import com.reverie.app.ui.components.CoverTiles
import com.reverie.app.ui.screens.collections.collectionAccent
import com.reverie.app.ui.screens.collections.current

/** The three sizes a favourite's picture is drawn at: the Collections shelf, the Files strip and the grid. */
enum class FavouritePictureStyle(
    val corner: Dp,
    val iconSize: Dp,
    val labelSize: TextUnit,
    val labelAlignment: Alignment,
    /** Size of the corner mark that tells a folder from a file; null where the line under the name says so. */
    val folderMark: Dp?,
    val thumbnail: ThumbnailSize,
) {
    SHELF(14.dp, 28.dp, 11.sp, Alignment.TopStart, null, ThumbnailSize.SM),
    STRIP(16.dp, 24.dp, 12.sp, Alignment.Center, 20.dp, ThumbnailSize.SM),
    GRID(16.dp, 30.dp, 14.sp, Alignment.Center, 24.dp, ThumbnailSize.MD),
}

/**
 * A favourite's picture, filling [modifier]'s bounds: a folder's cover, a collection's icon, a
 * file's thumbnail or kind block, or a padlock for a private item (which arrives with nothing else).
 */
@Composable
fun FavouritePicture(
    item: FavouriteDto,
    style: FavouritePictureStyle,
    modifier: Modifier = Modifier,
    overlay: @Composable BoxScope.() -> Unit = {},
) {
    Box(
        modifier.clip(RoundedCornerShape(style.corner)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        val folder = item.folder
        val document = item.document
        when {
            item.isPrivate -> PrivatePicture(style)
            folder?.type == FolderType.COLLECTION -> CollectionPicture(folder, style)
            folder != null -> FolderPicture(folder, style)
            document != null -> DocumentPicture(document, style)
        }
        overlay()
    }
}

@Composable
private fun PrivatePicture(style: FavouritePictureStyle) {
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.tertiaryContainer), contentAlignment = Alignment.Center) {
        Icon(
            Icons.Outlined.Lock,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onTertiaryContainer,
            modifier = Modifier.size(style.iconSize),
        )
    }
}

@Composable
private fun CollectionPicture(collection: FolderWithChildren, style: FavouritePictureStyle) {
    val accent = collectionAccent(collection.id).current()
    val tint = accent.copy(alpha = 0.18f).compositeOver(MaterialTheme.colorScheme.surfaceContainerHighest)
    Box(Modifier.fillMaxSize().background(tint), contentAlignment = Alignment.Center) {
        SectionIcon(emoji = collection.emoji, size = style.iconSize, tint = accent)
    }
}

@Composable
private fun BoxScope.FolderPicture(folder: FolderWithChildren, style: FavouritePictureStyle) {
    val tiles = folder.cover?.tiles.orEmpty().take(4)
    if (tiles.isEmpty()) {
        Icon(
            Icons.Outlined.Folder,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(style.iconSize),
        )
    } else {
        CoverTiles(tiles, gap = 2.dp, modifier = Modifier.fillMaxSize())
    }
    style.folderMark?.let { FolderMark(it, Modifier.align(Alignment.BottomStart).padding(if (it > 20.dp) 8.dp else 6.dp)) }
}

/** The same in both themes: it sits on the picture. */
@Composable
private fun FolderMark(size: Dp, modifier: Modifier) {
    Box(modifier.size(size).background(ON_PICTURE_SCRIM, CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Folder, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * 0.6f))
    }
}

@Composable
private fun DocumentPicture(document: DocumentDto, style: FavouritePictureStyle) {
    if (!document.hasRenderedThumbnail) {
        FileKindBlock(
            mimeType = document.mime_type,
            filename = document.original_filename,
            modifier = Modifier.fillMaxSize(),
            labelAlignment = style.labelAlignment,
            labelSize = style.labelSize,
        )
        return
    }
    DocumentThumbnail(
        documentId = document.id,
        mimeType = document.mime_type,
        filename = document.original_filename,
        blurhash = document.thumbnail_blurhash,
        hasThumbnail = true,
        modifier = Modifier.fillMaxSize(),
        size = style.thumbnail,
        // Favourites never write to disk, so a file that turns private later leaves nothing from here.
        diskCachePolicy = CachePolicy.READ_ONLY,
    )
}

/** Which kind of thing a favourite is, for the screen's filter and counts. Collections count as folders. */
fun FavouriteDto.isFolder(): Boolean = type == FavouriteType.FOLDER
