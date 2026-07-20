package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize

/**
 * The single visual that carries the document-open container transform: the tapped tile's thumbnail,
 * reused straight from Coil's memory cache (keyed by id) so it's on screen from the very first frame
 * — no spinner and no cross-fade in the shared node (that produced the washed "flash").
 *
 * It's drawn with [ContentScale.Crop] and the shared-bounds node is sized to the image's real aspect
 * rect (see DocumentScreen), so a square grid tile grows into an aspect-matched rectangle: Crop fills
 * both ends exactly, so there is no crop→fit morph and, crucially, no overshoot — the drawn image
 * grows monotonically from the tile to its final letterboxed size. The full-res zoomable image mounts
 * on top of this once the transform settles (see [ImageViewer]).
 */
@Composable
fun DocumentDiveHero(
    documentId: String,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val context = LocalContext.current
    AsyncImage(
        model = ImageRequest.Builder(context)
            .data(ThumbnailRef(documentId, GRID_THUMBNAIL_SIZE))
            .memoryCacheKey(thumbnailMemoryCacheKey(documentId, GRID_THUMBNAIL_SIZE))
            // Large mosaic feature tiles decode at LG, not GRID_THUMBNAIL_SIZE (see MosaicGrid), so
            // a doc tapped there misses the MD memory key — the LG placeholder keeps the hero on
            // screen from frame 1 while MD loads instead of morphing a blank box.
            .placeholderMemoryCacheKey(thumbnailMemoryCacheKey(documentId, ThumbnailSize.LG))
            .build(),
        contentDescription = null,
        contentScale = contentScale,
        modifier = modifier.fillMaxSize(),
    )
}
