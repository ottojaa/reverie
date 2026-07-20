@file:OptIn(ExperimentalSharedTransitionApi::class)

package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.SharedTransitionScope.ResizeMode
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideOutVertically
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.layout.ContentScale

/**
 * Scopes for the Google-Photos-style container transform on document open. Provided by
 * [com.reverie.app.ui.navigation.MainShell] (the shared-transition layout) and each nav
 * destination (its AnimatedContentScope). Both are null-safe so previews/tests that don't set
 * them fall back to no transform.
 */
val LocalSharedTransitionScope = staticCompositionLocalOf<SharedTransitionScope?> { null }
val LocalNavAnimatedContentScope = staticCompositionLocalOf<AnimatedVisibilityScope?> { null }

fun documentBoundsKey(documentId: String): String = "document-$documentId"

// Portion of the dive over which mismatched contents crossfade (see documentSharedBounds).
private const val DIVE_CROSSFADE_FRACTION = 0.4f

/**
 * Marks a composable as the shared container for a document — the grid tile and the viewer share
 * the same key, so the tile expands into the viewer (and shrinks back on return). A no-op when the
 * scopes aren't present (previews, tests, or a screen outside the shared-transition layout).
 *
 * [crossfade] = false (media): both ends draw the SAME cropped thumbnail, so there is no fade at
 * all — fading identical content only produced the washed/translucent "flash" — and the child is
 * re-measured against the animating bounds each frame so its Crop applies at the interpolated size
 * (no ScaleToBounds "FillWidth" overshoot ballooning non-portrait thumbnails past the screen).
 *
 * [crossfade] = true (type-correct stand-ins whose content genuinely differs from the tile): the
 * two ends fade through each other near the TILE end of the morph, where the box is small and the
 * mismatch least visible — the stand-in fades in over the still-opaque tile as the box starts
 * growing, and on the dive back fades out only over the tail of the shrink. ScaleToBounds lays the
 * stand-in out ONCE at its full-screen size and scales it into the animating bounds, so its text
 * never re-wraps mid-morph the way per-frame remeasurement would force.
 */
@Composable
fun Modifier.documentSharedBounds(documentId: String, crossfade: Boolean = false): Modifier {
    val sharedScope = LocalSharedTransitionScope.current ?: return this
    val navScope = LocalNavAnimatedContentScope.current ?: return this
    val spec = MotionTuning.spec
    val diveEasing = spec.diveEasing.toEasing()
    val fadeMs = (spec.diveMs * DIVE_CROSSFADE_FRACTION).toInt()

    return with(sharedScope) {
        this@documentSharedBounds.sharedBounds(
            rememberSharedContentState(key = documentBoundsKey(documentId)),
            animatedVisibilityScope = navScope,
            enter = if (crossfade) fadeIn(tween(fadeMs)) else EnterTransition.None,
            exit = if (crossfade) fadeOut(tween(fadeMs, delayMillis = spec.diveMs - fadeMs)) else ExitTransition.None,
            resizeMode = if (crossfade) ResizeMode.ScaleToBounds(ContentScale.Crop) else ResizeMode.RemeasureToBounds,
            boundsTransform = BoundsTransform { _, _ -> tween(spec.diveMs, easing = diveEasing) },
            // Above the tile it fades over (both never fade together, so nothing washes out), and
            // below the viewer toolbar's overlay layer (zIndexInOverlay = 1f).
            zIndexInOverlay = if (crossfade) 0.5f else 0f,
            // Clip the morphing element to the (square) tile silhouette so it never paints outside.
            clipInOverlayDuringTransition = OverlayClip(RectangleShape),
        )
    }
}

/**
 * Lifts content (the viewer toolbar) into the shared-transition overlay above the transforming
 * element, so it stays visible during the container transform instead of being occluded.
 */
@Composable
fun Modifier.aboveSharedElements(): Modifier {
    val sharedScope = LocalSharedTransitionScope.current ?: return this

    return with(sharedScope) {
        this@aboveSharedElements.renderInSharedTransitionScopeOverlay(zIndexInOverlay = 1f)
    }
}

/**
 * Drives a piece of viewer chrome off the nav [AnimatedVisibilityScope] so it slides off + fades on
 * back navigation (the pop), concurrently with the container transform — instead of just fading with
 * the screen. Composes cleanly with the chrome's own immersive-toggle AnimatedVisibility (that one
 * governs tap-to-hide; this one governs screen enter/exit). A no-op outside the nav scope.
 *
 * The top toolbar slides up ([fromBottom] = false); the bottom action bar slides down
 * ([fromBottom] = true), so both leave symmetrically toward their own screen edge.
 */
@Composable
fun Modifier.animateViewerChrome(fromBottom: Boolean = false): Modifier {
    val navScope = LocalNavAnimatedContentScope.current ?: return this
    val exitMs = MotionTuning.spec.toolbarExitMs

    return with(navScope) {
        this@animateViewerChrome.animateEnterExit(
            enter = fadeIn(tween(exitMs)),
            exit = slideOutVertically(tween(exitMs)) { if (fromBottom) it else -it } + fadeOut(tween(exitMs)),
        )
    }
}
