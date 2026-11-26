package com.reverie.app.ui.screens.library

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.ui.graphics.vector.ImageVector
import com.reverie.app.data.api.model.QuickFilter

internal const val FAVOURITES_SHORTCUT = "favourites"
internal const val TRASH_SHORTCUT = "trash"

/** Every shortcut chip the app has, in the order they come in until they are moved. */
internal val SHORTCUT_IDS = listOf(FAVOURITES_SHORTCUT) + SMART_VIEW_IDS + TRASH_SHORTCUT

/**
 * Every chip in the [saved] order. A chip [saved] does not name (one the app has gained since) comes at the
 * end, and a name the app no longer has a chip for is left out.
 */
internal fun orderedShortcuts(saved: List<String>): List<String> =
    saved.distinct().filter { it in SHORTCUT_IDS } + SHORTCUT_IDS.filterNot { it in saved }

/**
 * [order] after the chips on show were moved into the order of [shown]: they take, in that order, the places
 * they held between them. A chip not on show (a ready-made search that finds nothing) stays where it was.
 */
internal fun reorderedShortcuts(order: List<String>, shown: List<String>): List<String> {
    val moved = shown.iterator()
    return order.map { if (it in shown) moved.next() else it }
}

/** One chip of the Library's strip. */
internal data class Shortcut(
    val id: String,
    val icon: ImageVector,
    val label: String,
    val count: Int?,
    val onOpen: () -> Unit,
)

/**
 * The chips there are to show: Favourites, the ready-made searches that find something, and the trash. None
 * until their saved order is known, so that they are never seen to change places.
 */
internal fun libraryShortcuts(
    smartViews: List<QuickFilter>,
    marks: LibraryMarks,
    links: LibraryLinks,
): List<Shortcut> {
    val order = marks.shortcutOrder ?: return emptyList()
    val favourites = Shortcut(
        FAVOURITES_SHORTCUT, Icons.Outlined.StarBorder, "Favourites", marks.favouriteCount, links.onOpenFavourites,
    )
    val searches = smartViews.map { view ->
        Shortcut(view.id, smartViewIcon(view.id), view.label, view.count) { links.onSearch(view.query) }
    }
    val trash = Shortcut(TRASH_SHORTCUT, Icons.Outlined.Delete, "Trash", count = null, links.onOpenTrash)
    val byId = (searches + favourites + trash).associateBy { it.id }
    return orderedShortcuts(order).mapNotNull(byId::get)
}

private fun smartViewIcon(id: String): ImageVector = when (id) {
    "screenshots" -> Icons.Outlined.Smartphone
    "receipts" -> Icons.Outlined.Receipt
    "statements" -> Icons.AutoMirrored.Outlined.TrendingUp
    "large-files" -> Icons.Outlined.Storage
    else -> Icons.Outlined.Search
}
