package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.snap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import coil.request.ImageRequest
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.ui.navigation.LocalSharedTransitionScope
import me.saket.telephoto.zoomable.coil.ZoomableAsyncImage
import me.saket.telephoto.zoomable.rememberZoomableImageState
import me.saket.telephoto.zoomable.rememberZoomableState

/**
 * The full-resolution, pinch-zoom/pan image. During the container transform the [DocumentDiveHero]
 * (drawn behind this in DocumentScreen) shows the tapped thumbnail and does the grow; this only
 * mounts the zoomable image once the transform has settled AND the signed URL has arrived, so a
 * cache-hot full-res image can't pop in at full size mid-transform. It then stays mounted (so the
 * close transform doesn't flicker), painting over the hero at the same centered-fit position. The
 * grid thumbnail is reused as the zoomable's placeholder so the swap is seamless.
 *
 * Inside a HorizontalPager, telephoto retains pan/zoom across state restorations, so a page swiped
 * away while zoomed would restore that transform when scrolled back to. [isSettledPage] tells us
 * when this page is off the settled position; we reset its zoom then (telephoto's pager recipe).
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun ImageViewer(
    fileUrl: String?,
    documentId: String,
    hasThumbnail: Boolean,
    contentDescription: String,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    isSettledPage: Boolean = true,
) {
    val context = LocalContext.current
    val transitionActive = LocalSharedTransitionScope.current?.isTransitionActive == true

    val zoomableState = rememberZoomableState()
    val imageState = rememberZoomableImageState(zoomableState)
    LaunchedEffect(isSettledPage) {
        if (!isSettledPage) zoomableState.resetZoom(snap())
    }

    var zoomableShown by remember { mutableStateOf(false) }
    if (fileUrl != null && !transitionActive) zoomableShown = true

    if (fileUrl != null && zoomableShown) {
        ZoomableAsyncImage(
            state = imageState,
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
    } else {
        // Transparent while the hero behind carries the transform; nothing to draw here yet.
        Box(modifier.fillMaxSize())
    }
}
