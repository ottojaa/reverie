package com.reverie.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.ui.graphics.vector.ImageVector

/** The four bottom-nav destinations (Google-Photos-style IA: Files / Collections / Search / Settings). */
sealed class Screen(
    val route: String,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector,
) {
    data object Files : Screen("browse", "Files", Icons.Filled.PhotoLibrary, Icons.Outlined.PhotoLibrary)
    data object Collections : Screen("collections", "Collections", Icons.Filled.Folder, Icons.Outlined.Folder)
    data object Search : Screen("search", "Search", Icons.Filled.Search, Icons.Outlined.Search)
    data object Settings : Screen("settings", "Settings", Icons.Filled.Settings, Icons.Outlined.Settings)

    companion object {
        // Reach this (or Routes.tabRoutes) before any tab object: a tab touched first initialises this
        // list while it is itself half-built, which leaves a null in it.
        val bottomNavItems = listOf(Files, Collections, Search, Settings)
    }
}

/** Non-tab routes pushed onto whichever tab's back stack the user is in. */
object Routes {
    const val FOLDER = "folder/{folderId}"
    fun folder(folderId: String) = "folder/$folderId"

    /** One kind of the whole library (photos, videos, files) as its own screen. */
    const val KIND = "browse/kind/{kind}"
    fun kind(kind: String) = "browse/kind/$kind"

    // `from` is the back-stack entry id of the screen whose tile the viewer grows out of (see LocalDiveOrigin),
    // or a value that is no entry's id when there is no such tile.
    // Optional `ar` (aspect ratio) lets the document-open container transform size itself correctly
    // from the very first frame instead of waiting for the record to load.
    const val DOCUMENT = "document/{id}?from={from}&ar={ar}"
    fun document(id: String, from: String, aspect: Float? = null) =
        "document/$id?from=$from" + (aspect?.let { "&ar=$it" } ?: "")

    const val FAVOURITES = "favourites"

    const val SETTINGS_PASSWORD = "settings/password"
    const val SETTINGS_PRIVACY = "settings/privacy"
    const val SETTINGS_BACKUP = "settings/backup"

    /** Routes where the bottom bar is hidden. */
    val fullScreenRoutes = setOf(DOCUMENT)

    /** The four bottom-nav destinations. Switching between these fades; pushing a detail slides. */
    val tabRoutes: Set<String> = Screen.bottomNavItems.map { it.route }.toSet()
}
