package com.reverie.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.reverie.app.ui.screens.browse.BrowseScreen
import com.reverie.app.ui.screens.document.DocumentScreen
import com.reverie.app.ui.screens.search.SearchScreen
import com.reverie.app.ui.screens.settings.SettingsScreen
import com.reverie.app.ui.screens.upload.UploadScreen

@Composable
fun ReverieNavGraph(
    navController: NavHostController,
    modifier: Modifier = Modifier
) {
    NavHost(
        navController = navController,
        startDestination = Screen.Browse.route,
        modifier = modifier
    ) {
        composable(Screen.Browse.route) {
            BrowseScreen(
                onDocumentClick = { documentId ->
                    navController.navigate(Screen.Document.createRoute(documentId))
                }
            )
        }
        
        composable(Screen.Upload.route) {
            UploadScreen()
        }
        
        composable(Screen.Search.route) {
            SearchScreen(
                onDocumentClick = { documentId ->
                    navController.navigate(Screen.Document.createRoute(documentId))
                }
            )
        }
        
        composable(Screen.Settings.route) {
            SettingsScreen()
        }
        
        composable(
            route = Screen.Document.route,
            arguments = listOf(
                navArgument("id") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val documentId = backStackEntry.arguments?.getString("id") ?: ""
            DocumentScreen(
                documentId = documentId,
                onBackClick = { navController.popBackStack() }
            )
        }
    }
}




