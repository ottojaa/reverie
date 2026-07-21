package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.snap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import com.reverie.app.ui.navigation.LocalSharedTransitionScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import me.saket.telephoto.subsamplingimage.SubSamplingImage
import me.saket.telephoto.subsamplingimage.SubSamplingImageSource
import me.saket.telephoto.subsamplingimage.rememberSubSamplingImageState
import me.saket.telephoto.zoomable.DoubleClickToZoomListener
import me.saket.telephoto.zoomable.ZoomSpec
import me.saket.telephoto.zoomable.ZoomableContentLocation
import me.saket.telephoto.zoomable.rememberZoomableState
import me.saket.telephoto.zoomable.zoomable
import okio.Path.Companion.toPath
import java.io.File
import kotlin.math.roundToInt

/** Pinch ceiling. Sub-sampling keeps the original crisp at this zoom, so it can be generous. */
private const val MAX_IMAGE_ZOOM = 6f

/** Double-tap toggles resting-fit ↔ this factor (matches the PDF viewer's feel; not native-res). */
private const val DOUBLE_TAP_ZOOM = 2.5f

/**
 * The full-resolution, pinch-zoom/pan image, rendered full-screen so a zoomed image can use the
 * whole screen (it is NOT constrained to the letterboxed thumbnail box). During the container
 * transform the [DocumentDiveHero] (in the aspect box behind this) shows the tapped thumbnail and
 * does the grow/shrink; this draws nothing while a transition is in flight so it never covers the
 * hero's dive in/out.
 *
 * ## Why this doesn't use `ZoomableAsyncImage`, and how the "zoom instantly, stay crisp" handoff works
 * telephoto's high-level `ZoomableAsyncImage` keeps zoom & pan DISABLED while its placeholder is
 * showing (it gives the placeholder a *separate* zoomable state that swallows gestures — making
 * placeholders zoomable is telephoto's own open issue #104). So gestures wouldn't work until the
 * whole original had downloaded. We instead compose telephoto's building blocks under ONE shared
 * [zoomableState] and drive the transform ourselves, which sidesteps that lock:
 *  - [zoomableState] has `autoApplyTransformations = false`, so `Modifier.zoomable` only detects
 *    gestures — WE apply `state.contentTransformation` (a public [graphicsLayer] spec) to each layer.
 *  - **Base layer** (instant): the grid thumbnail, laid out at the image's real pixel size and
 *    transformed by `contentTransformation`, so it pans/zooms from frame 1 — no waiting on pixels.
 *  - **Crisp layer**: once the original lands on disk, [SubSamplingImage] draws sub-sampled tiles.
 *    It reads the SAME [zoomableState], so it adopts the live zoom/pan with no reset — a seamless
 *    upgrade — and self-draws its tiles at the transformed positions (that's why the modifier's
 *    transform must stay off; `rememberSubSamplingImageState` also forces `autoApply` false).
 * Double-tap-to-zoom comes for free from `Modifier.zoomable`'s `onDoubleClick`.
 *
 * Inside a HorizontalPager telephoto retains pan/zoom across state restorations, so a page swiped
 * away while zoomed would restore that transform when scrolled back to. [isSettledPage] tells us
 * when this page is off the settled position; we reset its zoom then and drop the original so
 * off-screen pages don't hold a decoder.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun ImageViewer(
    documentId: String,
    contentSize: Size?,
    hasThumbnail: Boolean,
    contentDescription: String,
    loadFile: suspend (onProgress: (Float) -> Unit) -> File,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    isSettledPage: Boolean = true,
    // Disabled while the details pane is open so the lifted media is a clean pager/drag/tap surface
    // (no pinch-zoom on the thumbnail).
    gesturesEnabled: Boolean = true,
    // Reports true once the image is zoomed past its resting fit — the viewer hides its chrome then.
    onZoomChanged: (Boolean) -> Unit = {},
    // Fired once this viewer first has drawable content (its base thumbnail is laid out and placed),
    // so DocumentPage can drop the dive hero behind it without risking a blank frame at the swap.
    onContentVisible: () -> Unit = {},
) {
    val transitionActive = LocalSharedTransitionScope.current?.isTransitionActive == true

    val zoomableState = rememberZoomableState(
        // preventOverOrUnderZoom (default) rubber-bands past the fit/max bounds and snaps back.
        zoomSpec = ZoomSpec(maxZoomFactor = MAX_IMAGE_ZOOM),
        // We apply the transform to each layer ourselves (see KDoc); sub-sampling forces this false
        // too, so keeping it off from the start avoids a flip when the crisp layer mounts.
        autoApplyTransformations = false,
    )
    zoomableState.contentScale = ContentScale.Fit
    zoomableState.contentAlignment = Alignment.Center

    // Enable gestures immediately: tell telephoto the content rect from the image's known pixel size
    // so pinch/pan/double-tap work on the thumbnail before the original loads. Sub-sampling re-sets
    // this from the decoded size (same rect) when it mounts, so ownership transfers without a jump.
    LaunchedEffect(contentSize) {
        if (contentSize != null && !contentSize.isEmpty()) {
            zoomableState.setContentLocation(ZoomableContentLocation.scaledInsideAndCenterAligned(contentSize))
        }
    }
    LaunchedEffect(isSettledPage) {
        if (!isSettledPage) zoomableState.resetZoom(snap())
    }
    LaunchedEffect(zoomableState) {
        snapshotFlow { (zoomableState.zoomFraction ?: 0f) > 0.01f }
            .distinctUntilChanged()
            .collect { onZoomChanged(it) }
    }
    // The transform is specified only once the zoomable has both a content location and a laid-out
    // viewport — i.e. this viewer is composed, settled, and its base layer is about to draw.
    LaunchedEffect(zoomableState) {
        snapshotFlow { zoomableState.contentTransformation.isSpecified }.first { it }
        onContentVisible()
    }

    // Fetch the original to disk for sub-sampling, but only for the settled page — neighbors must
    // not download originals, and a page swiped away drops its decoder (file → null).
    val file by produceState<File?>(null, documentId, isSettledPage) {
        value = if (isSettledPage) runCatching { loadFile {} }.getOrNull() else null
    }
    val currentFile = file
    val subState = if (currentFile != null) {
        val source = remember(currentFile) { SubSamplingImageSource.file(currentFile.absolutePath.toPath()) }
        rememberSubSamplingImageState(source, zoomableState)
    } else {
        null
    }

    // Draw nothing during the dive: the DiveHero behind carries the morph (both on enter and, since
    // this is a full-screen sibling, on the dive back).
    if (transitionActive) {
        Box(modifier.fillMaxSize())
        return
    }

    val zoomGestures = if (gesturesEnabled) {
        Modifier.zoomable(
            state = zoomableState,
            onClick = { onTap() },
            onDoubleClick = DoubleClickToZoomListener.cycle(maxZoomFactor = DOUBLE_TAP_ZOOM),
        )
    } else {
        Modifier
    }

    Box(modifier.fillMaxSize().then(zoomGestures)) {
        // Base layer: the grid thumbnail, instantly zoomable. Laid out at the content's real pixel
        // size and transformed by the shared contentTransformation, so it occupies the exact rect
        // sub-sampling will — kept until the crisp tiles cover the frame. Skipped when the image
        // dimensions are unknown (no rect to place it in) — sub-sampling then shows on its own.
        if (hasThumbnail && contentSize != null && !contentSize.isEmpty() && subState?.isImageDisplayed != true) {
            Box(
                Modifier
                    .layout { measurable, _ ->
                        val w = contentSize.width.roundToInt()
                        val h = contentSize.height.roundToInt()
                        val placeable = measurable.measure(Constraints.fixed(w, h))
                        layout(w, h) { placeable.place(0, 0) }
                    }
                    .graphicsLayer {
                        val t = zoomableState.contentTransformation
                        if (t.isSpecified) {
                            scaleX = t.scale.scaleX
                            scaleY = t.scale.scaleY
                            translationX = t.offset.x
                            translationY = t.offset.y
                            transformOrigin = t.transformOrigin
                        } else {
                            // Not laid out yet: collapse (scale 0) rather than alpha 0, which on this
                            // real-pixel-sized node could force a large offscreen buffer.
                            scaleX = 0f
                            scaleY = 0f
                        }
                    },
            ) {
                DocumentDiveHero(documentId, Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
            }
        }
        // Crisp sub-sampled original once on disk; reads the SAME zoomableState → live zoom/pan
        // carries over with no jump, and it self-draws its tiles at the transformed positions.
        subState?.let {
            SubSamplingImage(
                state = it,
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
