package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.layout.Box
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
import me.saket.telephoto.zoomable.coil.ZoomableAsyncImage

/**
 * Full-resolution image with pinch-zoom/pan; tap toggles the immersive toolbar. Until the signed
 * URL arrives (it's never cached), the grid's already-decoded thumbnail is shown from the memory
 * cache, so the container transform lands on a real image instead of a blank frame.
 */
@Composable
fun ImageViewer(
    fileUrl: String?,
    documentId: String,
    hasThumbnail: Boolean,
    contentDescription: String,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    when {
        fileUrl != null -> ZoomableAsyncImage(
            model = ImageRequest.Builder(context)
                .data(fileUrl)
                .apply {
                    if (hasThumbnail) placeholderMemoryCacheKey(thumbnailMemoryCacheKey(documentId, GRID_THUMBNAIL_SIZE))
                }
                .build(),
            contentDescription = contentDescription,
            modifier = modifier.fillMaxSize(),
            onClick = { onTap() },
        )
        hasThumbnail -> AsyncImage(
            model = ImageRequest.Builder(context)
                .data(ThumbnailRef(documentId, GRID_THUMBNAIL_SIZE))
                .memoryCacheKey(thumbnailMemoryCacheKey(documentId, GRID_THUMBNAIL_SIZE))
                .build(),
            contentDescription = contentDescription,
            contentScale = ContentScale.Fit,
            modifier = modifier.fillMaxSize(),
        )
        else -> Box(modifier.fillMaxSize())
    }
}
