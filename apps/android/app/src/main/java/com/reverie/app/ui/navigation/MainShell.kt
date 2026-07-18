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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController

/** The authenticated app shell: the tab/detail nav graph with an overlaid bottom navigation bar. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun MainShell(
    navController: NavHostController = rememberNavController(),
    hideNavOnScroll: Boolean = false,
) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val fullScreen = currentRoute in Routes.fullScreenRoutes

    // Attribute detail routes (folder/*) to the tab they were opened from, so that tab stays
    // highlighted and tapping it returns there instead of doing nothing.
    var lastTabRoute by rememberSaveable { mutableStateOf(Screen.Files.route) }
    val scrollVisible = remember { mutableStateOf(true) }
    LaunchedEffect(currentRoute) {
        scrollVisible.value = true
        if (currentRoute in Routes.tabRoutes) lastTabRoute = currentRoute!!
    }
    val selectedRoute = currentRoute?.takeIf { it in Routes.tabRoutes } ?: lastTabRoute
    val barVisible = !fullScreen && (!hideNavOnScroll || scrollVisible.value)

    // SharedTransitionLayout wraps the whole shell so the document container transform renders in
    // its overlay above the bottom bar (which slides away underneath). The NavHost fills the window
    // and never resizes on navigation — the bottom bar is an overlay that slides out of the way.
    SharedTransitionLayout {
        CompositionLocalProvider(
            LocalSharedTransitionScope provides this,
            LocalBottomBarScrollState provides scrollVisible,
        ) {
            Box(Modifier.fillMaxSize()) {
                ReverieNavGraph(
                    navController = navController,
                    modifier = Modifier.fillMaxSize(),
                )
                AnimatedVisibility(
                    visible = barVisible,
                    enter = slideInVertically { it } + fadeIn(),
                    exit = slideOutVertically { it } + fadeOut(),
                    modifier = Modifier.align(Alignment.BottomCenter),
                ) {
                    ReverieBottomBar(
                        selectedRoute = selectedRoute,
                        onTabClick = { screen -> onTabSelected(navController, screen, selectedRoute, currentRoute) { lastTabRoute = it } },
                    )
                }
            }
        }
    }
}

@Composable
private fun ReverieBottomBar(
    selectedRoute: String,
    onTabClick: (Screen) -> Unit,
) {
    NavigationBar {
        Screen.bottomNavItems.forEach { screen ->
            val selected = screen.route == selectedRoute
            NavigationBarItem(
                icon = {
                    Icon(
                        imageVector = if (selected) screen.selectedIcon else screen.unselectedIcon,
                        contentDescription = screen.title,
                    )
                },
                label = { Text(screen.title) },
                selected = selected,
                onClick = { onTabClick(screen) },
            )
        }
    }
}

/**
 * Tapping a tab: if we're already on that tab's stack with a detail on top, return to its root;
 * if we're at the root already, do nothing; otherwise switch tabs (save/restore each tab's stack).
 */
private fun onTabSelected(
    navController: NavHostController,
    screen: Screen,
    selectedRoute: String,
    currentRoute: String?,
    rememberTab: (String) -> Unit,
) {
    val onThisTab = selectedRoute == screen.route
    val atDetail = currentRoute !in Routes.tabRoutes
    when {
        onThisTab && atDetail -> {
            if (!navController.popBackStack(screen.route, inclusive = false)) navigateToTab(navController, screen.route)
        }
        onThisTab -> Unit
        else -> {
            navigateToTab(navController, screen.route)
            rememberTab(screen.route)
        }
    }
}

private fun navigateToTab(navController: NavHostController, route: String) {
    navController.navigate(route) {
        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
