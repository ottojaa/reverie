package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.snap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.flow.distinctUntilChanged
import coil.request.ImageRequest
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.ui.navigation.LocalSharedTransitionScope
import me.saket.telephoto.zoomable.coil.ZoomableAsyncImage
import me.saket.telephoto.zoomable.rememberZoomableImageState
import me.saket.telephoto.zoomable.rememberZoomableState

/**
 * The full-resolution, pinch-zoom/pan image, rendered full-screen so a zoomed image can use the
 * whole screen (it is NOT constrained to the letterboxed thumbnail box). During the container
 * transform the [DocumentDiveHero] (in the aspect box behind this) shows the tapped thumbnail and
 * does the grow/shrink; this mounts only once no transition is in flight AND the signed URL has
 * arrived, so the full-screen image never pops in mid-transform nor covers the hero's dive back. The
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
    // Disabled while the details pane is open so the lifted media is a clean pager/drag/tap surface
    // (no pinch-zoom on the thumbnail).
    gesturesEnabled: Boolean = true,
    // Reports true once the image is zoomed past its resting fit — the viewer hides its chrome then.
    onZoomChanged: (Boolean) -> Unit = {},
) {
    val context = LocalContext.current
    val transitionActive = LocalSharedTransitionScope.current?.isTransitionActive == true

    val zoomableState = rememberZoomableState()
    val imageState = rememberZoomableImageState(zoomableState)
    LaunchedEffect(isSettledPage) {
        if (!isSettledPage) zoomableState.resetZoom(snap())
    }
    LaunchedEffect(zoomableState) {
        snapshotFlow { (zoomableState.zoomFraction ?: 0f) > 0.01f }
            .distinctUntilChanged()
            .collect { onZoomChanged(it) }
    }

    // Mount the full-screen zoomable only when no nav transition is in flight: during the dive
    // in/out the DiveHero behind carries the morph, and this full-screen image would otherwise cover
    // it (both on enter and — now that it's a full-screen sibling — on the dive back).
    val zoomableShown = fileUrl != null && !transitionActive

    if (zoomableShown) {
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
            gesturesEnabled = gesturesEnabled,
            onClick = { onTap() },
        )
    } else {
        // Transparent while the hero behind carries the transform; nothing to draw here yet.
        Box(modifier.fillMaxSize())
    }
}
