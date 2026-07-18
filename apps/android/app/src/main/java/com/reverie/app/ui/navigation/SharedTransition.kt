@file:OptIn(ExperimentalSharedTransitionApi::class)

package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

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

    return with(sharedScope) {
        this@documentSharedBounds.sharedBounds(
            rememberSharedContentState(key = documentBoundsKey(documentId)),
            animatedVisibilityScope = navScope,
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
