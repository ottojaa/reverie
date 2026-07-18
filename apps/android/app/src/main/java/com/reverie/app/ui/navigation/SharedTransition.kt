@file:OptIn(ExperimentalSharedTransitionApi::class)

package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
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

/**
 * Scopes for the Google-Photos-style container transform on document open. Provided by
 * [com.reverie.app.ui.navigation.MainShell] (the shared-transition layout) and each nav
 * destination (its AnimatedContentScope). Both are null-safe so previews/tests that don't set
 * them fall back to no transform.
 */
val LocalSharedTransitionScope = staticCompositionLocalOf<SharedTransitionScope?> { null }
val LocalNavAnimatedContentScope = staticCompositionLocalOf<AnimatedVisibilityScope?> { null }

fun documentBoundsKey(documentId: String): String = "document-$documentId"

/**
 * Marks a composable as the shared container for a document — the grid tile and the viewer share
 * the same key, so the tile expands into the viewer (and shrinks back on return). A no-op when the
 * scopes aren't present (previews, tests, or a screen outside the shared-transition layout).
 */
@Composable
fun Modifier.documentSharedBounds(documentId: String): Modifier {
    val sharedScope = LocalSharedTransitionScope.current ?: return this
    val navScope = LocalNavAnimatedContentScope.current ?: return this
    val spec = MotionTuning.spec
    val diveEasing = spec.diveEasing.toEasing()

    return with(sharedScope) {
        this@documentSharedBounds.sharedBounds(
            rememberSharedContentState(key = documentBoundsKey(documentId)),
            animatedVisibilityScope = navScope,
            // Re-measure the shared child against the animating bounds each frame so its own
            // ContentScale applies at the interpolated size — this removes the ScaleToBounds
            // "FillWidth" overshoot that made non-portrait thumbnails balloon past the screen.
            resizeMode = ResizeMode.RemeasureToBounds,
            boundsTransform = BoundsTransform { _, _ -> tween(spec.diveMs, easing = diveEasing) },
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
 * Drives the viewer toolbar off the nav [AnimatedVisibilityScope] so it slides up + fades on back
 * navigation (the pop), concurrently with the container transform — instead of just fading with the
 * screen. Composes cleanly with the toolbar's own immersive-toggle AnimatedVisibility (that one
 * governs tap-to-hide; this one governs screen enter/exit). A no-op outside the nav scope.
 */
@Composable
fun Modifier.animateViewerChrome(): Modifier {
    val navScope = LocalNavAnimatedContentScope.current ?: return this
    val exitMs = MotionTuning.spec.toolbarExitMs

    return with(navScope) {
        this@animateViewerChrome.animateEnterExit(
            enter = fadeIn(tween(exitMs)),
            exit = slideOutVertically(tween(exitMs)) { -it } + fadeOut(tween(exitMs)),
        )
    }
}
