package com.reverie.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Image
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import com.reverie.app.ui.components.LIBRARY_NAME
import com.reverie.app.ui.components.LibraryIcon

/** The two places the bottom pill switches between, in the order it shows them. */
enum class Tab(val route: String, val title: String) {
    LIBRARY(Routes.LIBRARY, LIBRARY_NAME),
    PHOTOS(Routes.PHOTOS, "Photos"),
    ;

    val icon: ImageVector get() = if (this == LIBRARY) LibraryIcon else Icons.Outlined.Image
}

/** The tab the screen on show was opened from: Photos when its root is somewhere below, else the Library. */
internal fun NavController.currentTab(): Tab =
    if (runCatching { getBackStackEntry(Routes.PHOTOS) }.isSuccess) Tab.PHOTOS else Tab.LIBRARY

internal fun NavHostController.openTab(tab: Tab) = when (tab) {
    Tab.LIBRARY -> openLibrary()
    Tab.PHOTOS -> openPhotos()
}

/** The Library's root, from however deep. What was open on the Photos tab is kept for coming back to. */
private fun NavHostController.openLibrary() {
    popBackStack(Routes.LIBRARY, inclusive = false, saveState = currentTab() == Tab.PHOTOS)
}

/**
 * Photos as it was left; tapped while there, back to its root. The Library's own pages are dropped on
 * the way: its button always shows the root, so nothing would ever return to them.
 */
private fun NavHostController.openPhotos() {
    if (currentTab() == Tab.PHOTOS) {
        popBackStack(Routes.PHOTOS, inclusive = false)
        return
    }
    navigate(Routes.PHOTOS) {
        popUpTo(Routes.LIBRARY)
        launchSingleTop = true
        restoreState = true
    }
}
