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
import com.reverie.app.ui.screens.account.AccountEntry
import com.reverie.app.ui.screens.account.AccountLinks
import com.reverie.app.ui.screens.browse.FeedScreen
import com.reverie.app.ui.screens.browse.FolderScreen
import com.reverie.app.ui.screens.document.DocumentScreen
import com.reverie.app.ui.screens.favourites.FavouritesScreen
import com.reverie.app.ui.screens.library.LibraryLinks
import com.reverie.app.ui.screens.library.LibraryScreen
import com.reverie.app.ui.screens.privatefolders.PrivateFoldersScreen
import com.reverie.app.ui.screens.search.SearchScreen
import com.reverie.app.ui.screens.settings.ChangePasswordScreen
import com.reverie.app.ui.screens.settings.SettingsScreen
import com.reverie.app.ui.screens.settings.backup.BackupSettingsScreen
import com.reverie.app.ui.screens.trash.TrashScreen

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
        reverieDestinations(navController)
    }
}

/** Every screen of the app, under its route. */
internal fun NavGraphBuilder.reverieDestinations(navController: NavHostController) {
    tabs(navController)
    lists(navController)
    viewer(navController)
    settings(navController)
}

/** The two roots of the bottom pill. */
private fun NavGraphBuilder.tabs(navController: NavHostController) {
    reverieComposable(Routes.LIBRARY) { entry ->
        LibraryScreen(
            links = navController.libraryLinks(),
            onDocumentClick = { id, aspect, section -> navController.openDocument(entry, id, aspect, section) },
            account = { AccountEntry(navController.accountLinks()) },
        )
    }

    reverieComposable(Routes.PHOTOS, Routes.photosArguments) { entry ->
        FeedScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = null,
            onSearch = { navController.navigate(Routes.search(it)) },
            account = { AccountEntry(navController.accountLinks()) },
        )
    }
}

private fun NavHostController.libraryLinks() = LibraryLinks(
    onOpenFolder = { showFolder(it) },
    onOpenList = { navigate(Routes.feed(it)) },
    onOpenMyFiles = { navigate(Routes.MY_FILES) },
    onOpenFavourites = { navigate(Routes.FAVOURITES) },
    onSearch = { navigate(Routes.search(query = it)) },
    onOpenTrash = { navigate(Routes.TRASH) },
)

private fun NavHostController.accountLinks() = AccountLinks(
    onOpenBackup = { navigate(Routes.SETTINGS_BACKUP) },
    onOpenPrivateFolders = { navigate(Routes.PRIVATE_FOLDERS) },
    onOpenSettings = { navigate(Routes.SETTINGS) },
)

/** The screens pushed over a tab that list folders and documents. */
private fun NavGraphBuilder.lists(navController: NavHostController) {
    reverieComposable(Routes.MY_FILES) { entry -> FolderDestination(navController, entry) }
    reverieComposable(Routes.FOLDER, Routes.folderArguments) { entry -> FolderDestination(navController, entry) }

    // A list pushed over the Library: its own list state, paging and selection; back finds the Library as it was.
    reverieComposable(Routes.FEED, Routes.feedArguments) { entry ->
        FeedScreen(
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
            onBack = { navController.popBackStack() },
            onSearch = { navController.navigate(Routes.search(it)) },
        )
    }

    reverieComposable(Routes.FAVOURITES) { entry ->
        FavouritesScreen(
            onBack = { navController.popBackStack() },
            onOpenFolder = { navController.showFolder(it) },
            onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
        )
    }

    composable(Routes.PRIVATE_FOLDERS) {
        PrivateFoldersScreen(
            onBack = { navController.popBackStack() },
            onOpenFolder = { navController.showFolder(it) },
        )
    }

    composable(Routes.TRASH) {
        TrashScreen(onBack = { navController.popBackStack() })
    }

    reverieComposable(Routes.SEARCH, Routes.searchArguments) { entry ->
        SearchScreen(
            onBack = { navController.popBackStack() },
            onDocumentClick = { navController.openDocument(entry, it) },
            onOpenFolder = { navController.showFolder(it) },
        )
    }
}

/** A folder's page; reached without a folder id it is the root, "My files". */
@Composable
private fun FolderDestination(navController: NavHostController, entry: NavBackStackEntry) {
    FolderScreen(
        onDocumentClick = { id, aspect -> navController.openDocument(entry, id, aspect) },
        onBack = { navController.popBackStack() },
        onOpenFolder = { navController.showFolder(it) },
        onOpenCrumb = { navController.openCrumb(it) },
        onSearch = { navController.navigate(Routes.search(it)) },
    )
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
            onBack = { navController.popBackStack() },
            onChangePassword = { navController.navigate(Routes.SETTINGS_PASSWORD) },
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

/** Opens a folder on top of this screen, whether or not it is open further down: back returns here. */
internal fun NavHostController.showFolder(folderId: String) = navigate(Routes.folder(folderId))

/**
 * Goes to a breadcrumb step (null: the root, "My files"). A page already on the way here is gone back to; any
 * other is opened on top.
 */
internal fun NavHostController.openCrumb(folderId: String?) {
    val route = folderId?.let(Routes::folder) ?: Routes.MY_FILES
    if (!popBackStack(route, inclusive = false)) navigate(route)
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
