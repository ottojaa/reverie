package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.request.CachePolicy
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderCoverTileDto
import com.reverie.app.domain.model.ThumbnailSize

private val TILE_GAP = 1.dp
private val BADGE_SIZE = 26.dp
private val BADGE_RING = 2.dp
/** How far the badge reaches past the picture's lower right corner. */
private val BADGE_OVERHANG = 5.dp

/**
 * A folder in a list: a glimpse of what is in it under a round badge that says it is a folder.
 * An empty folder is a plain tile. A [locked] one is a plain tile too, with a lock in the badge.
 * The badge is ringed in the background colour, so the thumbnail belongs on that background.
 */
@Composable
fun FolderThumbnail(locked: Boolean, cover: FolderCoverDto?, modifier: Modifier = Modifier, size: Dp = ROW_PICTURE) {
    val tiles = if (locked) emptyList() else cover?.tiles.orEmpty().take(4)
    Box(modifier.size(size)) {
        val picture = Modifier.matchParentSize().clip(MaterialTheme.shapes.medium)
        if (tiles.isEmpty()) {
            Box(picture.background(MaterialTheme.colorScheme.surfaceContainer))
        } else {
            CoverTiles(tiles, picture)
        }
        FolderBadge(locked, Modifier.align(Alignment.BottomEnd).offset(BADGE_OVERHANG, BADGE_OVERHANG))
    }
}

@Composable
private fun FolderBadge(locked: Boolean, modifier: Modifier) {
    val label = if (locked) "Locked folder" else "Folder"
    Box(
        modifier
            .size(BADGE_SIZE)
            .semantics { contentDescription = label }
            .background(MaterialTheme.colorScheme.background, CircleShape)
            .padding(BADGE_RING)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (locked) Icons.Outlined.Lock else Icons.Filled.Folder,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.size(if (locked) 12.dp else 13.dp),
        )
    }
}

/**
 * One to four tiles as a 2×2 mosaic: one fills it, two split it in columns, three give the left
 * column to the first, four make the grid. A tile with a thumbnail shows it; one without shows its
 * file type.
 */
@Composable
private fun CoverTiles(tiles: List<FolderCoverTileDto>, modifier: Modifier) {
    val gap = Arrangement.spacedBy(TILE_GAP)
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
        when (tiles.size) {
            1 -> Tile(tiles[0], Modifier.fillMaxSize(), compact = false)
            2 -> Row(Modifier.fillMaxSize(), gap) {
                tiles.forEach { Tile(it, Modifier.weight(1f).fillMaxHeight()) }
            }
            3 -> Row(Modifier.fillMaxSize(), gap) {
                Tile(tiles[0], Modifier.weight(1f).fillMaxHeight())
                Column(Modifier.weight(1f).fillMaxHeight(), gap) {
                    Tile(tiles[1], Modifier.weight(1f).fillMaxSize())
                    Tile(tiles[2], Modifier.weight(1f).fillMaxSize())
                }
            }
            else -> Column(Modifier.fillMaxSize(), gap) {
                tiles.chunked(2).forEach { pair ->
                    Row(Modifier.weight(1f).fillMaxSize(), gap) {
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
        modifier = modifier,
        size = ThumbnailSize.SM,
        // A cover may read a thumbnail another screen cached, but never writes one: a folder that
        // is private (or turns private later) must leave nothing of itself on disk.
        diskCachePolicy = CachePolicy.READ_ONLY,
    )
}
