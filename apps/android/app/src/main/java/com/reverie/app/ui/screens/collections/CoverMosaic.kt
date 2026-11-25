package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.request.CachePolicy
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderCoverTileDto
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.FileKindBlock

internal val COVER_SIZE = 44.dp
private val COVER_SHAPE = RoundedCornerShape(11.dp)
private val TILE_GAP = 1.dp

/**
 * A folder's cover: its newest documents as a 2×2 mosaic. One tile fills it, two split it in
 * columns, three give the left column to the first, four make the grid. A tile with a thumbnail
 * shows it; one without shows its kind-tinted block. No tiles shows the folder icon.
 */
@Composable
fun CoverMosaic(cover: FolderCoverDto?, modifier: Modifier = Modifier) {
    val tiles = cover?.tiles.orEmpty().take(4)
    if (tiles.isEmpty()) {
        CoverIconBlock(Icons.Outlined.Folder, MaterialTheme.colorScheme.onSurfaceVariant, modifier)
        return
    }

    CoverTiles(tiles, TILE_GAP, modifier.size(COVER_SIZE).clip(COVER_SHAPE))
}

/** One to four cover tiles filling [modifier]'s bounds, [gap] apart. */
@Composable
internal fun CoverTiles(tiles: List<FolderCoverTileDto>, gap: Dp, modifier: Modifier = Modifier) {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
        when (tiles.size) {
            1 -> Tile(tiles[0], Modifier.fillMaxSize(), compact = false)
            2 -> Row(Modifier.fillMaxSize(), Arrangement.spacedBy(gap)) {
                tiles.forEach { Tile(it, Modifier.weight(1f).fillMaxHeight()) }
            }
            3 -> Row(Modifier.fillMaxSize(), Arrangement.spacedBy(gap)) {
                Tile(tiles[0], Modifier.weight(1f).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight(), Arrangement.spacedBy(gap)) {
                    Tile(tiles[1], Modifier.weight(1f).fillMaxSize())
                    Tile(tiles[2], Modifier.weight(1f).fillMaxSize())
                }
            }
            else -> Column(Modifier.fillMaxSize(), Arrangement.spacedBy(gap)) {
                tiles.chunked(2).forEach { pair ->
                    Row(Modifier.weight(1f).fillMaxSize(), Arrangement.spacedBy(gap)) {
                        pair.forEach { Tile(it, Modifier.weight(1f).fillMaxHeight()) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tile(tile: FolderCoverTileDto, modifier: Modifier, compact: Boolean = true) {
    if (!tile.hasRenderedThumbnail) {
        FileKindBlock(tile.mime_type, tile.original_filename, modifier, compact)
        return
    }

    DocumentThumbnail(
        documentId = tile.document_id,
        mimeType = tile.mime_type,
        filename = tile.original_filename,
        blurhash = tile.thumbnail_blurhash,
        hasThumbnail = true,
        // A cover tile carries no job status: a load that fails is tried again only when the tile is drawn anew.
        isThumbnailReady = true,
        modifier = modifier,
        size = ThumbnailSize.SM,
        // A cover may read a thumbnail another screen cached, but never writes one: a folder that
        // is private (or turns private later) must leave nothing of itself on disk.
        diskCachePolicy = CachePolicy.READ_ONLY,
    )
}

/** The cover's slot holding one icon: an empty folder, or a locked one. */
@Composable
fun CoverIconBlock(icon: ImageVector, tint: Color, modifier: Modifier = Modifier, background: Color = MaterialTheme.colorScheme.surfaceContainerHighest, iconSize: Dp = 20.dp) {
    Box(
        modifier.size(COVER_SIZE).clip(COVER_SHAPE).background(background),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
    }
}

/** The locked card's and a locked folder's cover: a padlock on the collection's accent. */
@Composable
fun LockedCover(accent: Color, modifier: Modifier = Modifier) = CoverIconBlock(
    icon = Icons.Outlined.Lock,
    tint = accent,
    background = accent.copy(alpha = 0.18f).compositeOver(MaterialTheme.colorScheme.surfaceContainerHighest),
    modifier = modifier,
    iconSize = 22.dp,
)
