package com.reverie.app.ui.screens.document

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.screens.viewer.DocumentViewerBody
import com.reverie.app.ui.screens.viewer.ViewerType
import com.reverie.app.ui.screens.viewer.viewerTypeFor
import com.reverie.app.ui.screens.viewer.viewers.DocumentDiveHero
import com.reverie.app.ui.screens.viewer.viewers.DocumentDiveStandIn
import com.reverie.app.ui.screens.viewer.viewers.VideoLetterboxFill

// The non-media viewers fade in over the settled dive stand-in once the morph settles. They're
// dropped instantly (no exit fade) the moment a transition begins, so only the light stand-in
// morphs — a heavy viewer (e.g. a long text file's giant layout) never re-measures under the
// dive-back transform.
private const val VIEWER_FADE_IN_MS = 180
// Once the player renders its first frame, fade the poster stand-in off it to reveal the video.
private const val VIDEO_POSTER_FADE_MS = 160

/**
 * One page of the swipe viewer: a single document's dive stand-in + real viewer, for [id],
 * parameterized so the pager can host many.
 *
 * Layering (bottom → top):
 *  1. For videos, the letterbox fill (per settings) — a plain screen layer, so it fades in with
 *     the screen during the dive and stays as the player's backdrop after settle.
 *  2. For videos, the player itself — a full-screen sibling mounted at settle (its setup can't
 *     stutter the morph), drawn BELOW the morph box so the poster in the box covers the player's
 *     black surface (during buffering) and its one-frame full-size stretch (before the aspect
 *     layout settles) until the first frame renders.
 *  3. The morph box carrying the shared element ([documentSharedBounds]). Media morph their own
 *     cropped thumbnail ([DocumentDiveHero]) inside an aspect-matched box — the box IS the content
 *     rect the settled viewer letterboxes into, so Crop fills both ends exactly and the tile grows
 *     seamlessly. For video the poster stays on top of the player until its first frame, then fades
 *     out. Every other type morphs a type-correct [DocumentDiveStandIn] full-screen, with a
 *     crossfade near the tile end since its content differs from the tile's pixels. PDF/text/
 *     fallback viewers ride INSIDE this box — mounted only once the transform settles and faded IN
 *     over the stand-in, then dropped instantly when a transition begins so only the light stand-in
 *     morphs on the dive back (a long text file's giant layout never re-measures mid-transform).
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
        // Media draw the SAME cropped bitmap at both ends of the morph (tile + hero) — no fade at
        // all. The type-correct stand-ins genuinely differ from the tile, so they crossfade.
        val seamlessHero = viewerType == null || viewerType == ViewerType.IMAGE ||
            (viewerType == ViewerType.VIDEO && hasThumbnail && effectiveAspect != null)
        val bounds =
            if (isCurrentPage) heroBounds.documentSharedBounds(id, crossfade = !seamlessHero) else heroBounds
        val transitionActive = LocalSharedTransitionScope.current?.isTransitionActive == true

        // The player reports its first rendered frame; until then (and during any transition) the
        // poster in the morph box stays over it, hiding the black surface + first-frame stretch.
        var videoFirstFrame by remember { mutableStateOf(false) }
        val revealVideo = viewerType == ViewerType.VIDEO && !transitionActive && videoFirstFrame
        // Fade the poster off once the frame lands; snap it back on (0ms) for the dive-back morph.
        val posterAlpha by animateFloatAsState(
            targetValue = if (revealVideo) 0f else 1f,
            animationSpec = tween(if (revealVideo) VIDEO_POSTER_FADE_MS else 0),
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
                    modifier = mod,
                )
            }
        }

        if (viewerType == ViewerType.VIDEO) {
            VideoLetterboxFill(videoBackground, id, hasThumbnail, Modifier.fillMaxSize())
            // Player below the morph box; the poster in the box covers its black surface + one-frame
            // stretch until onFirstFrameRendered fires. Mounts at settle so its setup can't jank the
            // morph.
            if (!transitionActive) viewer(Modifier.fillMaxSize())
        }

        Box(bounds) {
            when {
                // Keep the poster on top of the player until the first frame lands (posterAlpha → 0);
                // it snaps back to full opacity so the dive-back morph carries the poster, not black.
                viewerType == ViewerType.VIDEO -> {
                    if (posterAlpha > 0f) {
                        val posterMod = Modifier.fillMaxSize().graphicsLayer { alpha = posterAlpha }
                        if (seamlessHero) DocumentDiveHero(id, posterMod)
                        else document?.let { DocumentDiveStandIn(it, videoBackground, posterMod) }
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
