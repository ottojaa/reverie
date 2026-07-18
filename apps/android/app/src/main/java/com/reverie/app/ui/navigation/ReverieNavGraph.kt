package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.reverie.app.ui.screens.browse.BrowseScreen
import com.reverie.app.ui.screens.collections.CollectionsScreen
import com.reverie.app.ui.screens.document.DocumentScreen
import com.reverie.app.ui.screens.search.SearchScreen
import com.reverie.app.ui.screens.settings.SettingsScreen

private const val PUSH_MS = 300
private const val TAB_FADE_MS = 200

/** Switching between two bottom-nav tabs has no direction, so it fades instead of sliding. */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.betweenTabs(): Boolean =
    initialState.destination.route in Routes.tabRoutes &&
        targetState.destination.route in Routes.tabRoutes

@Composable
fun ReverieNavGraph(
    navController: NavHostController,
    modifier: Modifier = Modifier,
) {
    NavHost(
        navController = navController,
        startDestination = Screen.Files.route,
        modifier = modifier,
        // Directional shared-axis motion: pushing a detail slides in from the right; back reverses.
        // Tab↔tab switches fade (no meaningful direction).
        enterTransition = {
            if (betweenTabs()) fadeIn(tween(TAB_FADE_MS))
            else slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Left, tween(PUSH_MS)) + fadeIn(tween(PUSH_MS))
        },
        exitTransition = {
            if (betweenTabs()) fadeOut(tween(TAB_FADE_MS))
            else slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Left, tween(PUSH_MS)) + fadeOut(tween(PUSH_MS))
        },
        popEnterTransition = {
            if (betweenTabs()) fadeIn(tween(TAB_FADE_MS))
            else slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Right, tween(PUSH_MS)) + fadeIn(tween(PUSH_MS))
        },
        popExitTransition = {
            if (betweenTabs()) fadeOut(tween(TAB_FADE_MS))
            else slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Right, tween(PUSH_MS)) + fadeOut(tween(PUSH_MS))
        },
    ) {
        composable(Screen.Files.route) {
            BrowseScreen(
                onDocumentClick = { navController.navigate(Routes.document(it)) },
            )
        }

        composable(Screen.Collections.route) {
            CollectionsScreen(
                onOpenFolder = { navController.navigate(Routes.folder(it)) },
                onOpenAllDocuments = {
                    navController.navigate(Screen.Files.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
            )
        }

        composable(Screen.Search.route) {
            SearchScreen(
                onDocumentClick = { navController.navigate(Routes.document(it)) },
                onOpenFolder = { navController.navigate(Routes.folder(it)) },
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onChangePassword = { navController.navigate(Routes.SETTINGS_PASSWORD) },
            )
        }

        composable(Routes.SETTINGS_PASSWORD) {
            com.reverie.app.ui.screens.settings.ChangePasswordScreen(
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = Routes.FOLDER,
            arguments = listOf(navArgument("folderId") { type = NavType.StringType }),
        ) { entry ->
            val folderId = entry.arguments?.getString("folderId")
            BrowseScreen(
                folderId = folderId,
                onDocumentClick = { navController.navigate(Routes.document(it)) },
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = Routes.DOCUMENT,
            arguments = listOf(navArgument("id") { type = NavType.StringType }),
        ) { entry ->
            val documentId = entry.arguments?.getString("id") ?: ""
            DocumentScreen(
                documentId = documentId,
                onBackClick = { navController.popBackStack() },
            )
        }
    }
}
