package com.reverie.app.ui.navigation

import android.os.Build
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedContentTransitionScope.SlideDirection
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.navigation.NavBackStackEntry

// Material shared-axis X motion, tuned to match Seal: a short slide (a fraction of the width) with
// staggered fades, rather than a full-width slide that reads as harsh. The outgoing content fades
// over the first part of the duration; the incoming content fades over the rest.
//
// All numeric values now come from [MotionTuning.spec] (dev-tunable via Settings, see MotionSpec.kt)
// rather than compile-time constants. These functions are the NavHost's per-navigation transition
// lambdas — they run outside composition, so the plain snapshot read returns the current value.
private const val POP_SCALE_MS = 350

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisIn(towards: SlideDirection): EnterTransition {
    val s = MotionTuning.spec
    val outgoingMs = (s.navMs * s.progressThreshold).toInt()
    val incomingMs = s.navMs - outgoingMs
    return slideIntoContainer(towards, tween(s.navMs, easing = s.directionalEasing.toEasing())) { (it * s.slideFraction).toInt() } +
        fadeIn(tween(incomingMs, delayMillis = outgoingMs, easing = LinearOutSlowInEasing))
}

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisOut(towards: SlideDirection): ExitTransition {
    val s = MotionTuning.spec
    val outgoingMs = (s.navMs * s.progressThreshold).toInt()
    return slideOutOfContainer(towards, tween(s.navMs, easing = s.directionalEasing.toEasing())) { (it * s.slideFraction).toInt() } +
        fadeOut(tween(outgoingMs, easing = FastOutLinearInEasing))
}

// Predictive-back gesture (SDK 34+) seeks a subtle scale on the pop, matching Seal.
private fun popEnterScale(): EnterTransition =
    scaleIn(initialScale = MotionTuning.spec.popScale, animationSpec = tween(POP_SCALE_MS, easing = EasingPreset.EMPHASIZED_DECELERATE.toEasing()))

private fun popExitScale(): ExitTransition =
    scaleOut(targetScale = MotionTuning.spec.popScale, animationSpec = tween(POP_SCALE_MS, easing = EasingPreset.EMPHASIZED_ACCELERATE.toEasing()))

private fun tabIndex(route: String?): Int = Screen.bottomNavItems.indexOfFirst { it.route == route }

/** Both endpoints are bottom-nav tabs — the switch has a left/right direction, not a push. */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.betweenTabs(): Boolean =
    initialState.destination.route in Routes.tabRoutes && targetState.destination.route in Routes.tabRoutes

/** Moving to a higher-index tab slides forward (left); a lower-index tab slides back (right). */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.tabForward(): Boolean =
    tabIndex(targetState.destination.route) > tabIndex(initialState.destination.route)

/** Opening/closing the document viewer — a plain fade so the shared-element transform drives it. */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.involvesDocument(): Boolean =
    initialState.destination.route == Routes.DOCUMENT || targetState.destination.route == Routes.DOCUMENT

private fun tabDirection(forward: Boolean): SlideDirection =
    if (forward) SlideDirection.Left else SlideDirection.Right

fun AnimatedContentTransitionScope<NavBackStackEntry>.reverieEnter(): EnterTransition = when {
    involvesDocument() -> fadeIn(tween(MotionTuning.spec.diveMs))
    betweenTabs() -> sharedAxisIn(tabDirection(tabForward()))
    else -> sharedAxisIn(SlideDirection.Left)
}

fun AnimatedContentTransitionScope<NavBackStackEntry>.reverieExit(): ExitTransition = when {
    involvesDocument() -> fadeOut(tween(MotionTuning.spec.diveMs))
    betweenTabs() -> sharedAxisOut(tabDirection(tabForward()))
    else -> sharedAxisOut(SlideDirection.Left)
}

fun AnimatedContentTransitionScope<NavBackStackEntry>.reveriePopEnter(): EnterTransition = when {
    involvesDocument() -> fadeIn(tween(MotionTuning.spec.diveMs))
    betweenTabs() -> sharedAxisIn(tabDirection(tabForward()))
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> sharedAxisIn(SlideDirection.Right) + popEnterScale()
    else -> sharedAxisIn(SlideDirection.Right)
}

fun AnimatedContentTransitionScope<NavBackStackEntry>.reveriePopExit(): ExitTransition = when {
    involvesDocument() -> fadeOut(tween(MotionTuning.spec.diveMs))
    betweenTabs() -> sharedAxisOut(tabDirection(tabForward()))
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> sharedAxisOut(SlideDirection.Right) + popExitScale()
    else -> sharedAxisOut(SlideDirection.Right)
}
