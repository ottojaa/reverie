package com.reverie.app.ui.screens.document

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
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
// Once the player renders its first frame, crossfade the cover off it. The thumbnail poster and
// the first frame genuinely differ (the thumbnail is a ~1s grab), so the hand-off is soft — a hard
// swap read as an abrupt jump. The thumb-less fill cover just brightens through quickly.
private const val VIDEO_POSTER_CROSSFADE_MS = 300
private const val VIDEO_FILL_REVEAL_MS = 200
// The player parks its first frame here so it matches the thumbnail poster. Kotlin mirror of
// VIDEO_POSTER_FRAME_MS in @reverie/shared (libs/shared/src/domain/video.ts) — the canonical value
// the backend grabs the poster frame at; keep the two in sync. Just under 500ms so Media3's
// position display still reads 0:00 (it rounds to the nearest second). The viewer rewinds to 0 on
// first play, so the parked offset costs no playback.
private const val VIDEO_POSTER_FRAME_MS = 490L
// Buffering feedback appears only once the first frame has stalled past this hold-back — with the
// poster already on screen it's late feedback for genuinely slow loads, not part of a normal open.
private const val BUFFER_SPINNER_DELAY_MS = 400L
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
 *     (its inflation can't stutter the morph), drawn BELOW the morph box so the poster/fill
 *     cover in the box hides the player's opaque shutter (and its pre-first-frame surface) until
 *     the first frame renders.
 *  3. The morph box carrying the shared element ([documentSharedBounds]). Images morph their own
 *     cropped thumbnail ([DocumentDiveHero]) inside an aspect-matched box — the box IS the content
 *     rect the settled viewer letterboxes into, so Crop fills both ends exactly and the tile grows
 *     seamlessly. Video (with a poster + known aspect) morphs its own thumbnail the same way and
 *     HOLDS it as the poster over the player until the first frame, then crossfades poster→video
 *     (~300ms): a hard swap to the first frame read as an abrupt jump, and a fill cover meant a
 *     dead-black open however fast the stream arrived. Thumb-less videos morph the
 *     [VideoLetterboxFill] instead. Every other type morphs a type-correct
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
        // seamless = RemeasureToBounds (no crossfade). Images AND poster-backed videos draw the
        // SAME cropped bitmap at both ends (tile + hero/poster) so the box grows with no fade at
        // all — fading identical content only produced the washed/translucent "flash". The
        // type-correct stand-ins genuinely differ from the tile, so they crossfade instead.
        // A video with a poster + known aspect: the tile morphs its thumbnail as the poster, and the
        // player parks its first frame at the matching offset (see VIDEO_POSTER_FRAME_MS).
        val videoPosterBacked = viewerType == ViewerType.VIDEO && hasThumbnail && effectiveAspect != null
        val seamlessHero = viewerType == null || viewerType == ViewerType.IMAGE || videoPosterBacked
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
                // Poster → first frame: the player parks its first frame at the poster offset, so
                // these match closely; a short soft crossfade hides any keyframe-snap difference.
                videoPosterBacked ->
                    tween(VIDEO_POSTER_CROSSFADE_MS, easing = FastOutSlowInEasing)
                // Thumb-less fill cover just brightens into the first frame.
                else -> tween(VIDEO_FILL_REVEAL_MS, easing = FastOutSlowInEasing)
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
                    videoPosterSeekMs = if (videoPosterBacked) VIDEO_POSTER_FRAME_MS else null,
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
                // The cover over the player until its first frame renders, then posterAlpha fades
                // it off (snapping back to opaque so the dive-back morph carries it). Poster-backed:
                // the tile's own thumbnail, which the player now parks its first frame to match.
                // Otherwise (thumb-less): the solid/blur letterbox fill.
                viewerType == ViewerType.VIDEO -> {
                    if (posterAlpha > 0f) {
                        val coverModifier = Modifier.fillMaxSize().graphicsLayer { alpha = posterAlpha }
                        if (videoPosterBacked) {
                            // Poster hero: the tile's own bitmap morphs seamlessly into the video's
                            // content rect (this box), stays as the poster over the player, and
                            // crossfades to the video on its first frame — content is on screen for
                            // the entire open. A fill cover here meant a black void from tap to
                            // first frame no matter how fast the stream got.
                            DocumentDiveHero(id, coverModifier)
                        } else {
                            VideoLetterboxFill(videoBackground, id, hasThumbnail, coverModifier)
                        }
                    }
                    // Buffering feedback once the dive has settled: late reassurance for genuinely
                    // slow first frames (see BUFFER_SPINNER_DELAY_MS).
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
