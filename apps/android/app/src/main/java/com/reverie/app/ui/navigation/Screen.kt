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
        val bottomNavItems = listOf(Files, Collections, Search, Settings)
    }
}

/** Non-tab routes pushed onto whichever tab's back stack the user is in. */
object Routes {
    const val FOLDER = "folder/{folderId}"
    fun folder(folderId: String) = "folder/$folderId"

    // Optional `ar` (aspect ratio) lets the document-open container transform size itself correctly
    // from the very first frame instead of waiting for the record to load.
    const val DOCUMENT = "document/{id}?ar={ar}"
    fun document(id: String, aspect: Float? = null) =
        "document/$id" + (aspect?.let { "?ar=$it" } ?: "")

    const val SETTINGS_PASSWORD = "settings/password"
    const val SETTINGS_PRIVACY = "settings/privacy"

    /** Routes where the bottom bar is hidden. */
    val fullScreenRoutes = setOf(DOCUMENT)

    /** The four bottom-nav destinations. Switching between these fades; pushing a detail slides. */
    val tabRoutes: Set<String> = Screen.bottomNavItems.map { it.route }.toSet()
}
