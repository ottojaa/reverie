package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedContentScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NamedNavArgument
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.reverie.app.ui.screens.browse.FolderScreen
import com.reverie.app.ui.screens.browse.FeedScreen
import com.reverie.app.ui.screens.document.DocumentScreen
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.favourites.FavouritesScreen
import com.reverie.app.ui.screens.library.LibraryLinks
import com.reverie.app.ui.screens.library.LibraryScreen
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
        LibraryScreen(
            links = navController.libraryLinks(),
            onDocumentClick = { id, aspect, section -> navController.openDocument(entry, id, aspect, section) },
            onOpenAccount = { navController.navigate(Routes.SETTINGS) },
            onFavourite = { navController.openFavourite(it) },
        )
    }

    reverieComposable(Routes.PHOTOS, Routes.photosArguments) { entry ->
        FeedScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = null,
            onSearch = { navController.navigate(Routes.search(it)) },
            onFavourite = { navController.openFavourite(it) },
        )
    }
}

private fun NavHostController.libraryLinks() = LibraryLinks(
    onOpenFolder = { navigate(Routes.folder(it)) },
    onOpenList = { navigate(Routes.feed(it)) },
    onOpenFavourites = { navigate(Routes.FAVOURITES) },
    onSearch = { navigate(Routes.search(query = it)) },
    onOpenTrash = {},
)

/** The screens pushed over a tab that list folders and documents. */
private fun NavGraphBuilder.lists(navController: NavHostController) {
    reverieComposable(Routes.FOLDER, Routes.folderArguments) { entry ->
        FolderScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = { navController.popBackStack() },
            onOpenFolder = { navController.openFolder(it) },
            onSearch = { navController.navigate(Routes.search(it)) },
            onFavourite = { navController.openFavourite(it) },
        )
    }

    // A list pushed over the Library: its own list state, paging and selection; back finds the Library as it was.
    reverieComposable(Routes.FEED, Routes.feedArguments) { entry ->
        FeedScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = { navController.popBackStack() },
            onSearch = { navController.navigate(Routes.search(it)) },
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

/**
 * Opens the viewer from [origin]'s screen, so the tile there dives into it: the tile in [section], on a
 * screen whose lists have origins of their own.
 */
internal fun NavHostController.openDocument(
    origin: NavBackStackEntry,
    documentId: String,
    aspect: Float? = null,
    section: String? = null,
) {
    val from = section?.let { sectionOrigin(origin.id, it) } ?: origin.id
    navigate(Routes.document(documentId, from, aspect))
}

/**
 * Goes to a folder from inside one (null: the Library root). A folder already on the way here (a breadcrumb
 * step) is gone back to; any other is opened on top.
 */
internal fun NavHostController.openFolder(folderId: String?) {
    if (folderId == null) {
        popBackStack(Routes.LIBRARY, inclusive = false)
        return
    }
    val route = Routes.folder(folderId)
    if (!popBackStack(route, inclusive = false)) navigate(route)
}

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
