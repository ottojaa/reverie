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
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.imageLoader
import com.reverie.app.data.image.GRID_THUMBNAIL_SIZE
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.domain.model.ThumbnailSize
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
 * ## Zoom instantly, stay crisp, hand off cleanly
 * telephoto's high-level `ZoomableAsyncImage` keeps zoom & pan DISABLED while its placeholder shows
 * (its open issue #104), so gestures wouldn't work until the whole original downloaded. We instead
 * compose telephoto's building blocks under ONE shared [zoomableState] (`autoApplyTransformations =
 * false` — `Modifier.zoomable` only DETECTS gestures; WE apply the transform per layer):
 *  - **Base layer** (instant): the grid thumbnail, drawn full-screen at [ContentScale.Fit] and then
 *    re-projected onto telephoto's transform by [baseLayerTransform]. It pans/zooms from frame 1 —
 *    no waiting on pixels — and, crucially, is the IDENTITY at the resting fit and on any unspecified
 *    frame, so it always sits exactly where the dive hero was. There is no state that produces a
 *    giant or collapsed layer (the failure mode of the earlier real-pixel-sized base).
 *  - **Crisp layer**: once the original lands on disk, [SubSamplingImage] draws sub-sampled tiles off
 *    the SAME [zoomableState] → live zoom/pan carries over with no reset, self-drawing tiles at
 *    `raw*scale + offset` (matching the base layer exactly).
 *
 * Two invariants keep the open ("dive") handoff seamless — the giant/black frames it used to flash
 * are structurally impossible now:
 *  1. **One coordinate space forever:** [ZoomableContentLocation.unscaledAndTopLeftAligned] of the
 *     image's real pixel size — the same space [SubSamplingImage] uses. `rememberSubSamplingImageState`
 *     re-sets the location every composition (from its decoder's size, or the preview's size before
 *     that); we re-assert our known full-res size AFTER it while the decoder hasn't reported, so the
 *     transform is never in a smaller/placeholder space during the decoder-init window.
 *  2. **The base layer stays mounted under the crisp layer** as the blur-under, so the pre-decoder and
 *     tile-decode windows are covered without a `preview` — the hero handoff just waits for the dive to
 *     settle (no transform heuristic). A sub-sampling `preview` is passed ONLY when there is no base
 *     layer (unknown dimensions); with a base layer present it would mis-scale (see the source).
 *
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
    // Fired one frame after the dive settles and there is resting content on screen, so DocumentPage
    // can drop the dive hero behind this viewer without risking a blank frame at the swap.
    onContentVisible: () -> Unit = {},
) {
    val context = LocalContext.current
    val sharedScope = LocalSharedTransitionScope.current
    val transitionActive = sharedScope?.isTransitionActive == true

    val zoomableState = rememberZoomableState(
        // preventOverOrUnderZoom (default) rubber-bands past the fit/max bounds and snaps back.
        zoomSpec = ZoomSpec(maxZoomFactor = MAX_IMAGE_ZOOM),
        // We apply the transform to each layer ourselves (see KDoc); sub-sampling forces this false
        // too, so keeping it off from the start avoids a flip when the crisp layer mounts.
        autoApplyTransformations = false,
    )
    zoomableState.contentScale = ContentScale.Fit
    zoomableState.contentAlignment = Alignment.Center

    // Fetch the original to disk for sub-sampling, but only for the settled page — neighbors must
    // not download originals, and a page swiped away drops its decoder (file → null).
    val file by produceState<File?>(null, documentId, isSettledPage) {
        value = if (isSettledPage) runCatching { loadFile {} }.getOrNull() else null
    }
    // Keep sub-sampling dormant during the dive: it draws nothing then anyway (the hero carries the
    // morph), and there is no reason to spin up a tile decoder mid-animation. Gating here also means
    // its content-location bookkeeping can never perturb the shared transform while the dive is in
    // flight. The download itself is not gated (above), so the decoder starts the moment the dive ends.
    val currentFile = file
    val subState = if (currentFile != null && !transitionActive) {
        val source = remember(currentFile) {
            // Pass a preview ONLY when there is no base layer (unknown dimensions — see below). With a
            // base layer it is redundant (the base thumbnail is the blur-under) AND harmful: telephoto
            // sizes its tile grid to `imageOrPreviewSize`, which is the PREVIEW's size until the decoder
            // reports the real one. Our transform is forced into contentSize space, so sub-sampling
            // would draw its preview base tile (bounds in preview space) at the contentSize-space scale
            // → a small mis-scaled copy pinned to the top-left for the ~½s the decoder takes. Without a
            // preview, sub-sampling stays dormant until the decoder sizes it in OUR transform's space.
            val preview = if (contentSize != null) {
                null
            } else {
                context.imageLoader.memoryCache?.let { cache ->
                    (
                        cache.get(thumbnailMemoryCacheKey(documentId, GRID_THUMBNAIL_SIZE))
                            ?: cache.get(thumbnailMemoryCacheKey(documentId, ThumbnailSize.LG))
                        )?.bitmap?.asImageBitmap()
                }
            }
            SubSamplingImageSource.file(currentFile.absolutePath.toPath(), preview = preview)
        }
        rememberSubSamplingImageState(source, zoomableState)
    } else {
        null
    }

    // Hold the ONE coordinate space (raw pixels, top-left aligned — SubSamplingImage's own space).
    // rememberSubSamplingImageState re-sets the content location every composition; we re-assert our
    // known full-res size AFTER it while the decoder hasn't reported a size, so the transform is
    // never in a smaller/placeholder space during the decoder-init window (which is what collapsed
    // the base to black before). Once imageSize is known, sub-sampling's equal-valued location wins.
    if (subState?.imageSize == null && contentSize != null && !contentSize.isEmpty()) {
        zoomableState.setContentLocation(ZoomableContentLocation.unscaledAndTopLeftAligned(contentSize))
    }

    LaunchedEffect(isSettledPage) {
        if (!isSettledPage) zoomableState.resetZoom(snap())
    }
    LaunchedEffect(zoomableState) {
        snapshotFlow { (zoomableState.zoomFraction ?: 0f) > 0.01f }
            .distinctUntilChanged()
            .collect { onZoomChanged(it) }
    }
    // Hand off from the dive hero one frame after the dive settles and there is resting content to
    // show. The base layer at rest is pixel-identical to the hero, so no transform gate is needed
    // (the old userZoom≈1 heuristic is gone). Keyed on subState so the crisp-only path (unknown
    // dimensions → no base thumbnail) fires once sub-sampling actually paints.
    // Non-null exactly when we can place the base thumbnail layer: a thumbnail + known, non-empty
    // dimensions to build its fit rect from. Doubles as the "base is drawable" flag for the handoff.
    val baseSize = contentSize?.takeIf { hasThumbnail && !it.isEmpty() }
    LaunchedEffect(sharedScope, baseSize != null, subState) {
        snapshotFlow {
            val settled = sharedScope?.isTransitionActive != true
            settled && (baseSize != null || subState?.isImageDisplayed == true)
        }.first { it }
        withFrameNanos {}
        onContentVisible()
    }

    // Draw nothing during the dive: the DiveHero behind carries the morph (enter and, since this is
    // a full-screen sibling, the dive back). Gestures are off then, so a stray touch can't perturb
    // the shared element mid-transition.
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
        // Base layer: instantly zoomable thumbnail, drawn full-screen at Fit and re-projected onto
        // telephoto's raw-pixel transform by [baseLayerTransform]. Kept mounted under the crisp layer
        // as the blur-under; skipped only when dimensions are unknown (no fit rect to place it in).
        if (baseSize != null) {
            Box(
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val t = zoomableState.contentTransformation
                        val g = baseLayerTransform(
                            specified = t.isSpecified,
                            scaleX = t.scale.scaleX,
                            scaleY = t.scale.scaleY,
                            offsetX = t.offset.x,
                            offsetY = t.offset.y,
                            contentWidth = baseSize.width,
                            contentHeight = baseSize.height,
                            viewportWidth = size.width,
                            viewportHeight = size.height,
                        )
                        scaleX = g.scaleX
                        scaleY = g.scaleY
                        translationX = g.translationX
                        translationY = g.translationY
                        transformOrigin = TransformOrigin(0f, 0f)
                    },
            ) {
                DocumentDiveHero(documentId, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            }
        }
        // Crisp sub-sampled original once on disk; reads the SAME zoomableState → live zoom/pan
        // carries over with no jump, self-drawing tiles at raw*scale+offset (matching the base layer).
        subState?.let {
            SubSamplingImage(
                state = it,
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
