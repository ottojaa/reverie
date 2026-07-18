package com.reverie.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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

@Composable
fun ReverieNavGraph(
    navController: NavHostController,
    modifier: Modifier = Modifier,
) {
    NavHost(
        navController = navController,
        startDestination = Screen.Files.route,
        modifier = modifier,
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
