package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

/** The authenticated app shell: the tab/detail nav graph with an overlaid bottom navigation bar. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun MainShell(navController: NavHostController = rememberNavController()) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination
    val fullScreen = currentDestination?.route in Routes.fullScreenRoutes

    // The NavHost fills the window and never resizes on navigation — the bottom bar is an overlay
    // that slides out of the way, so opening/closing the edge-to-edge viewer doesn't reflow the
    // screen underneath (which used to make the grid jump and the document shrink). Each screen
    // owns its own insets; tab screens reserve [bottomBarInset] for this bar.
    //
    // SharedTransitionLayout wraps the whole shell so the document container transform renders in
    // its overlay above the bottom bar (which slides away underneath).
    SharedTransitionLayout {
        CompositionLocalProvider(LocalSharedTransitionScope provides this) {
            Box(Modifier.fillMaxSize()) {
                ReverieNavGraph(
                    navController = navController,
                    modifier = Modifier.fillMaxSize(),
                )
                AnimatedVisibility(
                    visible = !fullScreen,
                    enter = slideInVertically { it } + fadeIn(),
                    exit = slideOutVertically { it } + fadeOut(),
                    modifier = Modifier.align(Alignment.BottomCenter),
                ) {
                    ReverieBottomBar(navController = navController, currentDestination = currentDestination)
                }
            }
        }
    }
}

@Composable
private fun ReverieBottomBar(
    navController: NavHostController,
    currentDestination: NavDestination?,
) {
    NavigationBar {
        Screen.bottomNavItems.forEach { screen ->
            val selected = currentDestination?.hierarchy?.any { it.route == screen.route } == true
            NavigationBarItem(
                icon = {
                    Icon(
                        imageVector = if (selected) screen.selectedIcon else screen.unselectedIcon,
                        contentDescription = screen.title,
                    )
                },
                label = { Text(screen.title) },
                selected = selected,
                onClick = {
                    navController.navigate(screen.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
            )
        }
    }
}
