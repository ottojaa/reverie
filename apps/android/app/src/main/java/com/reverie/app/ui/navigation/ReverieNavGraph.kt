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
import com.reverie.app.ui.screens.browse.FolderScreen
import com.reverie.app.ui.screens.browse.KindScreen
import com.reverie.app.ui.screens.browse.routeOf
import com.reverie.app.ui.screens.collections.CollectionsScreen
import com.reverie.app.ui.screens.document.DocumentScreen
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.favourites.FavouritesScreen
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
        reverieComposable(Screen.Files.route) { entry ->
            BrowseScreen(
                onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
                onOpenKind = { navController.navigate(Routes.kind(routeOf(it))) },
                onFavourite = { navController.openFavourite(it) },
                onSeeAllFavourites = { navController.navigate(Routes.FAVOURITES) },
            )
        }

        composable(Screen.Collections.route) {
            CollectionsScreen(
                onOpenFolder = { navController.navigate(Routes.folder(it)) },
                onOpenAllDocuments = { navController.openTab(Screen.Files) },
                onFavourite = { navController.openFavourite(it) },
                onSeeAllFavourites = { navController.navigate(Routes.FAVOURITES) },
            )
        }

        reverieComposable(Routes.FAVOURITES) {
            FavouritesScreen(
                onBack = { navController.popBackStack() },
                onGo = { navController.openFavourite(it) },
            )
        }

        reverieComposable(Screen.Search.route) { entry ->
            SearchScreen(
                onDocumentClick = { navController.openDocument(entry, it) },
                onOpenFolder = { navController.navigate(Routes.folder(it)) },
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onChangePassword = { navController.navigate(Routes.SETTINGS_PASSWORD) },
                onOpenBackup = { navController.navigate(Routes.SETTINGS_BACKUP) },
            )
        }

        composable(Routes.SETTINGS_BACKUP) {
            com.reverie.app.ui.screens.settings.backup.BackupSettingsScreen(
                onBack = { navController.popBackStack() },
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
            FolderScreen(
                onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
                onBack = { navController.popBackStack() },
                onFavourite = { navController.openFavourite(it) },
            )
        }

        // A kind pushed over the dashboard: its own list state, paging and selection; back finds the dashboard as it was.
        reverieComposable(
            route = Routes.KIND,
            arguments = listOf(navArgument("kind") { type = NavType.StringType }),
        ) { entry ->
            KindScreen(
                onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
                onBack = { navController.popBackStack() },
                onFavourite = { navController.openFavourite(it) },
            )
        }

        reverieComposable(
            route = Routes.DOCUMENT,
            arguments = listOf(
                navArgument("id") { type = NavType.StringType },
                navArgument("from") { type = NavType.StringType },
                navArgument("ar") { type = NavType.FloatType; defaultValue = -1f },
            ),
        ) { entry ->
            val documentId = entry.arguments?.getString("id") ?: ""
            val aspect = (entry.arguments?.getFloat("ar") ?: -1f).takeIf { it > 0f }
            DocumentScreen(
                documentId = documentId,
                aspect = aspect,
                onBackClick = { navController.popBackStack() },
            )
        }
    }
}

/** A viewer origin that is no screen's: nothing matches it, so the viewer opens and closes with a plain fade. */
private const val NO_DIVE_ORIGIN = "none"

/** Switches to a bottom-nav tab, keeping each tab's back stack as it was. */
private fun NavHostController.openTab(tab: Screen) = navigate(tab.route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

/** Opens the viewer from [origin]'s screen, so the tile there dives into it. */
internal fun NavHostController.openDocument(origin: NavBackStackEntry, documentId: String, aspect: Float? = null) =
    navigate(Routes.document(documentId, origin.id, aspect))

/**
 * A starred document opens with [NO_DIVE_ORIGIN]: what was tapped is a favourites tile, and a list on the
 * same screen may hold the document too, whose row would otherwise fly into the viewer.
 */
internal fun NavHostController.openFavourite(destination: FavouriteDestination) {
    when (destination) {
        is FavouriteDestination.Folder -> navigate(Routes.folder(destination.id))
        // The screen reads which collection to show from CollectionFocus. A restored tab may have
        // screens on top of it; the collection is on the tab's own screen.
        is FavouriteDestination.Collection -> {
            openTab(Screen.Collections)
            popBackStack(Screen.Collections.route, inclusive = false)
        }
        is FavouriteDestination.Document ->
            navigate(Routes.document(destination.id, NO_DIVE_ORIGIN, destination.aspect))
    }
}

/**
 * A nav destination that shared-element transforms (document open) can bridge to and from: it exposes its
 * [AnimatedContentScope] via [LocalNavAnimatedContentScope], and via [LocalDiveOrigin] the screen whose
 * documents it matches: its own, or for the viewer (the one route with `from`) the screen that opened it.
 */
internal fun NavGraphBuilder.reverieComposable(
    route: String,
    arguments: List<NamedNavArgument> = emptyList(),
    content: @Composable AnimatedContentScope.(NavBackStackEntry) -> Unit,
) = composable(route, arguments) { entry ->
    CompositionLocalProvider(
        LocalNavAnimatedContentScope provides this,
        LocalDiveOrigin provides (entry.arguments?.getString("from") ?: entry.id),
    ) {
        content(entry)
    }
}
