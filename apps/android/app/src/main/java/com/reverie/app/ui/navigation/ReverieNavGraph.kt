package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedContentScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NamedNavArgument
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavGraphBuilder
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

@Composable
fun ReverieNavGraph(
    navController: NavHostController,
    modifier: Modifier = Modifier,
) {
    NavHost(
        navController = navController,
        startDestination = Screen.Files.route,
        modifier = modifier,
        // Material shared-axis motion (see Motion.kt): pushing a detail slides forward, back
        // reverses, and tab↔tab switches slide in the direction of the tab order.
        enterTransition = { reverieEnter() },
        exitTransition = { reverieExit() },
        popEnterTransition = { reveriePopEnter() },
        popExitTransition = { reveriePopExit() },
    ) {
        reverieComposable(Screen.Files.route) {
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

        reverieComposable(Screen.Search.route) {
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

        reverieComposable(
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

        reverieComposable(
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

/**
 * A nav destination that exposes its [AnimatedContentScope] via [LocalNavAnimatedContentScope] so
 * shared-element transforms (document open) can bridge across destinations.
 */
private fun NavGraphBuilder.reverieComposable(
    route: String,
    arguments: List<NamedNavArgument> = emptyList(),
    content: @Composable AnimatedContentScope.(NavBackStackEntry) -> Unit,
) = composable(route, arguments) { entry ->
    CompositionLocalProvider(LocalNavAnimatedContentScope provides this) {
        content(entry)
    }
}
