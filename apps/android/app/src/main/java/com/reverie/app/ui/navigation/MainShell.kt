package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.reverie.app.ui.components.LocalOpenLockSettings

/** The authenticated app shell: the nav graph with the bottom pill floating over its browsing screens. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun MainShell(
    navController: NavHostController = rememberNavController(),
    hideNavOnScroll: Boolean = false,
    graph: @Composable (Modifier) -> Unit = { ReverieNavGraph(navController, it) },
) {
    val entry by navController.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val selected = remember(entry) { navController.currentTab() }
    val scrollVisible = remember { mutableStateOf(true) }
    // The last screen that had the pill, so it keeps its look while it slides away from one that hasn't.
    var pillRoute by remember { mutableStateOf(Routes.LIBRARY) }
    // Remembered: a new lambda each time would recompose everything below the provider.
    val openLockSettings = remember(navController) { { navController.openLockSettings() } }
    LaunchedEffect(route) {
        scrollVisible.value = true
        if (route != null && route in Routes.pillRoutes) pillRoute = route
    }

    // SharedTransitionLayout wraps the whole shell so the document container transform renders in
    // its overlay above the pill (which slides away underneath). The NavHost fills the window
    // and never resizes on navigation: the pill is an overlay that slides out of the way.
    SharedTransitionLayout {
        // Keep the pill hidden while a shared transition is active, so on document close the
        // shrinking image (drawn in the shared-transition overlay) never paints over it as it
        // slides back in. On open, the route alone hides it, so this only affects the return.
        val barEnterMs = MotionTuning.spec.barEnterMs
        val onPillRoute = (route ?: Routes.LIBRARY) in Routes.pillRoutes
        val barVisible = onPillRoute && !isTransitionActive && (!hideNavOnScroll || scrollVisible.value)
        CompositionLocalProvider(
            LocalSharedTransitionScope provides this,
            LocalBottomBarScrollState provides scrollVisible,
            LocalOpenLockSettings provides openLockSettings,
        ) {
            Box(Modifier.fillMaxSize()) {
                graph(Modifier.fillMaxSize())
                AnimatedVisibility(
                    visible = barVisible,
                    enter = slideInVertically(tween(barEnterMs)) { it } + fadeIn(tween(barEnterMs)),
                    exit = slideOutVertically { it } + fadeOut(),
                    modifier = Modifier.align(Alignment.BottomCenter),
                ) {
                    BottomPill(
                        selected = selected,
                        onSelect = { navController.openTab(it) },
                        showSearch = pillRoute in Routes.searchButtonRoutes,
                        onSearch = { navController.navigate(Routes.search()) },
                    )
                }
            }
        }
    }
}
