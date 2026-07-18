package com.reverie.app.ui.navigation

import android.os.Build
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedContentTransitionScope.SlideDirection
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.navigation.NavBackStackEntry

// Material shared-axis X motion, tuned to match Seal: a short 10%-of-width slide with
// staggered fades, rather than a full-width slide that reads as harsh. The outgoing content
// fades over the first 35% of the duration; the incoming content fades over the last 65%.
private const val NAV_MS = 300
private const val POP_SCALE_MS = 350
private const val SLIDE_FRACTION = 0.10f
private const val PROGRESS_THRESHOLD = 0.35f
private const val POP_SCALE = 0.9f

private val OUTGOING_MS = (NAV_MS * PROGRESS_THRESHOLD).toInt()
private val INCOMING_MS = NAV_MS - OUTGOING_MS

private val EmphasizedDecelerate = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
private val EmphasizedAccelerate = CubicBezierEasing(0.3f, 0f, 1f, 1f)

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisIn(towards: SlideDirection): EnterTransition =
    slideIntoContainer(towards, tween(NAV_MS, easing = FastOutSlowInEasing)) { (it * SLIDE_FRACTION).toInt() } +
        fadeIn(tween(INCOMING_MS, delayMillis = OUTGOING_MS, easing = LinearOutSlowInEasing))

private fun AnimatedContentTransitionScope<NavBackStackEntry>.sharedAxisOut(towards: SlideDirection): ExitTransition =
    slideOutOfContainer(towards, tween(NAV_MS, easing = FastOutSlowInEasing)) { (it * SLIDE_FRACTION).toInt() } +
        fadeOut(tween(OUTGOING_MS, easing = FastOutLinearInEasing))

// Predictive-back gesture (SDK 34+) seeks a subtle scale on the pop, matching Seal.
private fun popEnterScale(): EnterTransition =
    scaleIn(initialScale = POP_SCALE, animationSpec = tween(POP_SCALE_MS, easing = EmphasizedDecelerate))

private fun popExitScale(): ExitTransition =
    scaleOut(targetScale = POP_SCALE, animationSpec = tween(POP_SCALE_MS, easing = EmphasizedAccelerate))

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
    involvesDocument() -> fadeIn(tween(NAV_MS))
    betweenTabs() -> sharedAxisIn(tabDirection(tabForward()))
    else -> sharedAxisIn(SlideDirection.Left)
}

fun AnimatedContentTransitionScope<NavBackStackEntry>.reverieExit(): ExitTransition = when {
    involvesDocument() -> fadeOut(tween(NAV_MS))
    betweenTabs() -> sharedAxisOut(tabDirection(tabForward()))
    else -> sharedAxisOut(SlideDirection.Left)
}

fun AnimatedContentTransitionScope<NavBackStackEntry>.reveriePopEnter(): EnterTransition = when {
    involvesDocument() -> fadeIn(tween(NAV_MS))
    betweenTabs() -> sharedAxisIn(tabDirection(tabForward()))
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> sharedAxisIn(SlideDirection.Right) + popEnterScale()
    else -> sharedAxisIn(SlideDirection.Right)
}

fun AnimatedContentTransitionScope<NavBackStackEntry>.reveriePopExit(): ExitTransition = when {
    involvesDocument() -> fadeOut(tween(NAV_MS))
    betweenTabs() -> sharedAxisOut(tabDirection(tabForward()))
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> sharedAxisOut(SlideDirection.Right) + popExitScale()
    else -> sharedAxisOut(SlideDirection.Right)
}
