package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedContentScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NamedNavArgument
import androidx.navigation.NavBackStackEntry
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
import com.reverie.app.ui.screens.document.DocumentScreen
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.favourites.FavouritesScreen
import com.reverie.app.ui.screens.search.SearchScreen
import com.reverie.app.ui.screens.settings.ChangePasswordScreen
import com.reverie.app.ui.screens.settings.SettingsScreen
import com.reverie.app.ui.screens.settings.backup.BackupSettingsScreen

@Composable
fun ReverieNavGraph(
    navController: NavHostController,
    modifier: Modifier = Modifier,
) {
    NavHost(
        navController = navController,
        startDestination = Routes.LIBRARY,
        modifier = modifier,
        // Material shared-axis motion (see Motion.kt): pushing a detail slides forward, back
        // reverses, and tab↔tab switches slide in the direction of the tab order.
        enterTransition = { reverieEnter() },
        exitTransition = { reverieExit() },
        popEnterTransition = { reveriePopEnter() },
        popExitTransition = { reveriePopExit() },
    ) {
        tabs(navController)
        lists(navController)
        viewer(navController)
        settings(navController)
    }
}

/** The two roots of the bottom pill. */
private fun NavGraphBuilder.tabs(navController: NavHostController) {
    reverieComposable(Routes.LIBRARY) { entry ->
        BrowseScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onOpenKind = { navController.navigate(Routes.kind(routeOf(it))) },
            onFavourite = { navController.openFavourite(it) },
            onSeeAllFavourites = { navController.navigate(Routes.FAVOURITES) },
        )
    }

    reverieComposable(Routes.PHOTOS, listOf(navArgument("kind") { type = NavType.StringType; defaultValue = "photos" })) { entry ->
        KindScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = { navController.popBackStack() },
            onFavourite = { navController.openFavourite(it) },
        )
    }
}

/** The screens pushed over a tab that list folders and documents. */
private fun NavGraphBuilder.lists(navController: NavHostController) {
    reverieComposable(Routes.FOLDER, Routes.folderArguments) { entry ->
        FolderScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = { navController.popBackStack() },
            onFavourite = { navController.openFavourite(it) },
        )
    }

    // A kind pushed over the Library: its own list state, paging and selection; back finds the Library as it was.
    reverieComposable(Routes.KIND, Routes.kindArguments) { entry ->
        KindScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = { navController.popBackStack() },
            onFavourite = { navController.openFavourite(it) },
        )
    }

    reverieComposable(Routes.FAVOURITES) {
        FavouritesScreen(
            onBack = { navController.popBackStack() },
            onGo = { navController.openFavourite(it) },
        )
    }

    reverieComposable(Routes.SEARCH, Routes.searchArguments) { entry ->
        SearchScreen(
            onDocumentClick = { navController.openDocument(entry, it) },
            onOpenFolder = { navController.navigate(Routes.folder(it)) },
        )
    }
}

private fun NavGraphBuilder.viewer(navController: NavHostController) {
    reverieComposable(Routes.DOCUMENT, Routes.documentArguments) { entry ->
        val aspect = (entry.arguments?.getFloat("ar") ?: -1f).takeIf { it > 0f }
        DocumentScreen(
            documentId = entry.arguments?.getString("id") ?: "",
            aspect = aspect,
            onBackClick = { navController.popBackStack() },
        )
    }
}

private fun NavGraphBuilder.settings(navController: NavHostController) {
    composable(Routes.SETTINGS) {
        SettingsScreen(
            onChangePassword = { navController.navigate(Routes.SETTINGS_PASSWORD) },
            onOpenBackup = { navController.navigate(Routes.SETTINGS_BACKUP) },
        )
    }
    composable(Routes.SETTINGS_BACKUP) {
        BackupSettingsScreen(onBack = { navController.popBackStack() })
    }
    composable(Routes.SETTINGS_PASSWORD) {
        ChangePasswordScreen(onBack = { navController.popBackStack() })
    }
}

/**
 * A viewer origin that is no screen's: nothing matches it, so the viewer opens and closes with a plain fade
 * and no list scrolls on return.
 */
private const val NO_DIVE_ORIGIN = "none"

/** Opens the viewer from [origin]'s screen, so the tile there dives into it. */
internal fun NavHostController.openDocument(origin: NavBackStackEntry, documentId: String, aspect: Float? = null) =
    navigate(Routes.document(documentId, origin.id, aspect))

/**
 * A starred document opens with [NO_DIVE_ORIGIN]: what was tapped is a favourites tile, and a list on the
 * same screen may hold the document too, whose row would otherwise fly into the viewer and be scrolled to.
 */
internal fun NavHostController.openFavourite(destination: FavouriteDestination) {
    when (destination) {
        is FavouriteDestination.Folder -> navigate(Routes.folder(destination.id))
        is FavouriteDestination.Document ->
            navigate(Routes.document(destination.id, NO_DIVE_ORIGIN, destination.aspect))
    }
}

/**
 * A nav destination that shared-element transforms (document open) can bridge to and from: it exposes its
 * [AnimatedContentScope] via [LocalNavAnimatedContentScope], and via [LocalDiveOrigin] the screen whose
 * documents it matches: its own, or for the viewer (the one route with `from`) the one its caller named.
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
