package com.reverie.app.ui.screens.document

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.data.settings.VideoBackground
import com.reverie.app.ui.navigation.LocalSharedTransitionScope
import com.reverie.app.ui.navigation.documentSharedBounds
import com.reverie.app.ui.navigation.videoBackdropInOverlay
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.DocumentViewerBody
import com.reverie.app.ui.screens.viewer.ViewerType
import com.reverie.app.ui.screens.viewer.viewerTypeFor
import com.reverie.app.ui.screens.viewer.viewers.DocumentDiveHero
import com.reverie.app.ui.screens.viewer.viewers.DocumentDiveStandIn
import com.reverie.app.ui.screens.viewer.viewers.VideoLetterboxFill
import kotlinx.coroutines.delay

// The non-media viewers fade in over the settled dive stand-in once the morph settles. They're
// dropped instantly (no exit fade) the moment a transition begins, so only the light stand-in
// morphs — a heavy viewer (e.g. a long text file's giant layout) never re-measures under the
// dive-back transform.
private const val VIEWER_FADE_IN_MS = 180
// Once the player renders its first frame, fade the letterbox-fill cover off it to reveal the
// video. The solid fills (BLACK/THEME) brighten into the frame quickly; the BLURRED cover melts
// into the video slowly with a soft landing — fast-start curves there read as an abrupt snap.
private const val VIDEO_POSTER_FADE_MS = 200
private const val VIDEO_BLUR_REVEAL_MS = 420
// Buffering feedback appears only once the first frame has stalled past this hold-back, so an
// already-buffered open never flashes a spinner.
private const val BUFFER_SPINNER_DELAY_MS = 250L
private const val BUFFER_SPINNER_FADE_MS = 150

/**
 * One page of the swipe viewer: a single document's dive stand-in + real viewer, for [id],
 * parameterized so the pager can host many.
 *
 * Layering (bottom → top):
 *  1. For videos, the letterbox fill (per settings) — lifted into the shared-transition overlay
 *     ([videoBackdropInOverlay]) with its own fast dim-in, so the letterbox areas go dark in sync
 *     with the (instantly-opaque) morph box instead of riding the screen's slower fade over the
 *     still-lit grid; after settle it stays as the player's backdrop.
 *  2. For videos, the player itself — a full-screen sibling composed from frame 1 (so ExoPlayer
 *     fetches + buffers through the dive) whose PlayerView surface attaches one frame after settle
 *     (its inflation can't stutter the morph), drawn BELOW the morph box so the letterbox-fill
 *     cover in the box hides the player's opaque shutter (and its pre-first-frame surface) until
 *     the first frame renders.
 *  3. The morph box carrying the shared element ([documentSharedBounds]). Images morph their own
 *     cropped thumbnail ([DocumentDiveHero]) inside an aspect-matched box — the box IS the content
 *     rect the settled viewer letterboxes into, so Crop fills both ends exactly and the tile grows
 *     seamlessly. Video morphs the [VideoLetterboxFill] instead of the thumbnail (the thumbnail is a
 *     ~1s frame — morphing it, then swapping to the video's first frame, read as an abrupt jump):
 *     RemeasureToBounds hard-cuts the tile to the fill, grows it, holds it over the player until the
 *     first frame, then fades to the video. Every other type morphs a type-correct
 *     [DocumentDiveStandIn] full-screen, with a crossfade near the tile end since its content differs
 *     from the tile's pixels. PDF/text/fallback viewers ride INSIDE this box — mounted only once the
 *     transform settles and faded IN over the stand-in, then dropped instantly when a transition
 *     begins so only the light stand-in morphs on the dive back.
 *  4. The image viewer as a full-screen sibling: a pinch-zoomed image uses the whole screen rather
 *     than being clipped to the letterboxed box. It mounts at settle; its content lands exactly on
 *     the hero rect beneath, and unmounting on the dive back reveals that same hero.
 *
 * The shared element is applied only to the **current** page so neighbor pages (composed by
 * [beyondViewportPageCount]) don't falsely match a grid tile of the same id.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun DocumentPage(
    id: String,
    aspectHint: Float?,
    isCurrentPage: Boolean,
    isSettledPage: Boolean,
    onMediaTap: () -> Unit,
    onDownloadStarted: () -> Unit,
    viewModel: DocumentViewModel,
    modifier: Modifier = Modifier,
    detailsOpen: Boolean = false,
    onZoomChanged: (Boolean) -> Unit = {},
    onVideoChromeHidden: (Boolean) -> Unit = {},
    videoBackground: VideoBackground = VideoBackground.BLACK,
) {
    val context = LocalContext.current
    val document by viewModel.observeDocument(id).collectAsStateWithLifecycle(initialValue = null)
    // Signed URLs are stripped from the cache; fetch (once, cached) when this page enters composition.
    // The pager only composes the current page ± beyondViewportPageCount, so only nearby pages fetch.
    val fileUrl by produceState<String?>(initialValue = null, id) { value = viewModel.fileUrl(id) }

    BoxWithConstraints(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        // Until the (Room-cached, ~1 frame) document lands, assume the media treatment — the hero
        // thumbnail in the nav-arg aspect box — so the morph starts correctly on frame 1.
        val viewerType = document?.let(::viewerTypeFor)
        val hasThumbnail = document?.hasRenderedThumbnail ?: true
        // Media fit themselves into an aspect-matched box (the dive-transform target); every other
        // viewer wants the full screen. Prefer the nav-arg aspect on the entry page (known on
        // frame 1) so the shared bounds never change shape mid-transition.
        val effectiveAspect = when {
            viewerType == null || viewerType == ViewerType.IMAGE ->
                aspectHint ?: document?.mediaAspectOrNull()
            viewerType == ViewerType.VIDEO && hasThumbnail ->
                aspectHint ?: document?.mediaAspectOrNull()
            else -> null
        }
        val screenAspect = maxWidth.value / maxHeight.value
        val heroBounds = when {
            effectiveAspect == null -> Modifier.fillMaxSize()
            effectiveAspect >= screenAspect -> Modifier.fillMaxWidth().aspectRatio(effectiveAspect)
            else -> Modifier.fillMaxHeight().aspectRatio(effectiveAspect, matchHeightConstraintsFirst = true)
        }
        // seamless = RemeasureToBounds (no crossfade). Images draw the SAME cropped bitmap at both
        // ends (tile + hero) so it grows with no fade; BLACK/THEME video uses the same no-fade mode
        // to hard-cut the tile to its solid letterbox-fill cover (fading to a flat colour reads
        // worse than the cut). BLURRED crossfades instead: its fill is the tile's own thumbnail
        // blurred, so the fade near the tile end reads as the tile going out of focus as it grows.
        // The type-correct stand-ins genuinely differ from the tile, so they crossfade too.
        val seamlessHero = viewerType == null || viewerType == ViewerType.IMAGE ||
            (viewerType == ViewerType.VIDEO && hasThumbnail && effectiveAspect != null &&
                videoBackground != VideoBackground.BLURRED)
        val bounds =
            if (isCurrentPage) heroBounds.documentSharedBounds(id, crossfade = !seamlessHero) else heroBounds
        val transitionActive = LocalSharedTransitionScope.current?.isTransitionActive == true

        // The letterbox-fill cover in the morph box hides the player until it renders its first
        // frame, then fades off to reveal the video. It snaps back on (0ms) when a transition begins
        // so the dive-back morph carries the fill, not the player's surface.
        var videoFirstFrame by remember { mutableStateOf(false) }
        // The PlayerView surface attaches one frame AFTER the dive settles — its inflation never
        // lands on the morph or the settle frame — and detaches the instant a transition starts,
        // so the dive-back never composes a live surface. videoFirstFrame resets with it: a
        // cancelled dive-back gets a fresh surface, and the cover must wait for THAT surface's
        // first frame.
        var settleFrameDrawn by remember { mutableStateOf(false) }
        LaunchedEffect(transitionActive) {
            settleFrameDrawn = false
            if (transitionActive) {
                videoFirstFrame = false
                return@LaunchedEffect
            }
            withFrameNanos { }
            settleFrameDrawn = true
        }
        val mountVideoSurface = !transitionActive && settleFrameDrawn
        val revealVideo = viewerType == ViewerType.VIDEO && !transitionActive && videoFirstFrame
        val posterAlpha by animateFloatAsState(
            targetValue = if (revealVideo) 0f else 1f,
            animationSpec = when {
                // Snap the cover back on the instant a transition starts (the morph carries it).
                !revealVideo -> tween(0)
                // The blurred cover melts into the video as a long, soft focus-in — a fast-start
                // curve here read as an abrupt snap to the frame.
                videoBackground == VideoBackground.BLURRED ->
                    tween(VIDEO_BLUR_REVEAL_MS, easing = LinearOutSlowInEasing)
                // Solid fills just brighten into the first frame; keep it quick so an
                // already-buffered open feels alive.
                else -> tween(VIDEO_POSTER_FADE_MS, easing = FastOutSlowInEasing)
            },
            label = "videoPoster",
        )

        val viewer: @Composable (Modifier) -> Unit = { mod ->
            document?.let { doc ->
                DocumentViewerBody(
                    document = doc,
                    fileUrl = fileUrl,
                    loadFile = { viewModel.originalFile(id) },
                    onMediaTap = onMediaTap,
                    onDownload = { if (downloadDocument(context, fileUrl, doc)) onDownloadStarted() },
                    isSettledPage = isSettledPage,
                    detailsOpen = detailsOpen,
                    // Only the current page's zoom drives the chrome — neighbors stay reset.
                    onZoomChanged = { zoomed -> if (isCurrentPage) onZoomChanged(zoomed) },
                    // Likewise, only the current page's video toggles the chrome.
                    onChromeHidden = { hidden -> if (isCurrentPage) onVideoChromeHidden(hidden) },
                    onFirstFrameRendered = { videoFirstFrame = true },
                    mountVideoSurface = mountVideoSurface,
                    modifier = mod,
                )
            }
        }

        if (viewerType == ViewerType.VIDEO) {
            VideoLetterboxFill(
                videoBackground, id, hasThumbnail,
                Modifier.fillMaxSize()
                    .videoBackdropInOverlay(soft = videoBackground == VideoBackground.BLURRED),
            )
            // Player below the morph box; the fill cover in the box hides its opaque shutter until
            // the first frame renders. The viewer composes from frame 1 so ExoPlayer fetches and
            // buffers THROUGH the dive (mounting it only at settle left a long dead-black gap
            // before the first frame); its PlayerView surface still waits for settle via
            // mountVideoSurface above.
            viewer(Modifier.fillMaxSize())
        }

        Box(bounds) {
            when {
                // The letterbox fill covers the player — never the ~1s thumbnail, whose mismatch with
                // the video's first frame read as an abrupt swap. RemeasureToBounds hard-cuts the tile
                // to it, grows it, and holds it over the player until the first frame; posterAlpha
                // then fades it to the video. Snaps back to opaque so the dive-back morph carries it.
                viewerType == ViewerType.VIDEO -> {
                    if (posterAlpha > 0f) {
                        VideoLetterboxFill(
                            videoBackground, id, hasThumbnail,
                            Modifier.fillMaxSize().graphicsLayer { alpha = posterAlpha },
                        )
                    }
                    // Buffering feedback once the dive has settled: a bare cover with nothing
                    // moving read as a hang while the first frame loaded over the network.
                    if (!transitionActive && !videoFirstFrame) {
                        VideoBufferingSpinner(Modifier.fillMaxSize())
                    }
                }
                seamlessHero -> DocumentDiveHero(id, Modifier.fillMaxSize())
                else -> document?.let { DocumentDiveStandIn(it, videoBackground, Modifier.fillMaxSize()) }
            }
            if (viewerType != null && viewerType != ViewerType.IMAGE && viewerType != ViewerType.VIDEO) {
                AnimatedVisibility(
                    visible = !transitionActive,
                    enter = fadeIn(tween(VIEWER_FADE_IN_MS)),
                    // Dropped instantly when a transition starts, so only the light stand-in morphs.
                    exit = ExitTransition.None,
                ) {
                    viewer(Modifier.fillMaxSize())
                }
            }
        }
        // Images self-gate on the transition (see ImageViewer's placeholder swap).
        if (viewerType == ViewerType.IMAGE) viewer(Modifier.fillMaxSize())
    }
}

/**
 * Centered spinner over the video's fill cover while the player buffers toward its first frame.
 * Held back [BUFFER_SPINNER_DELAY_MS] so an already-buffered open never flashes it, then eased in.
 */
@Composable
private fun VideoBufferingSpinner(modifier: Modifier = Modifier) {
    var show by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(BUFFER_SPINNER_DELAY_MS)
        show = true
    }
    if (!show) return
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) { alpha.animateTo(1f, tween(BUFFER_SPINNER_FADE_MS)) }
    Box(modifier.graphicsLayer { this.alpha = alpha.value }, contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
    }
}
