package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.domain.search.SearchScope

/** How a list lays its documents out. */
enum class FeedStyle {
    /** Under day headings: photos and videos as a grid, any other documents as rows. */
    DAYS,

    /** Rows that each say when their document was added. */
    ROWS,

    /** [ROWS], with media uploaded together folded into one row and same-named files stacked. */
    FOLDS,
}

/**
 * A list of the library's documents on a screen of its own: which documents it holds, what it is called, how
 * it is laid out and what its header search looks through. [argument] names it in a route.
 */
enum class FeedSource(
    val argument: String,
    val title: String,
    val scope: DocumentScope,
    val filter: DocumentFilter,
    val searchScope: SearchScope,
    val emptyTitle: String,
    val style: FeedStyle = FeedStyle.DAYS,
) {
    /** The Photos card's list, and the Photos tab. */
    PHOTOS("photos", "Photos", DocumentScope.All, DocumentFilter.IMAGES, SearchScope.Kind(DocumentKind.IMAGE), "No photos yet"),
    VIDEOS("videos", "Videos", DocumentScope.All, DocumentFilter.VIDEOS, SearchScope.Kind(DocumentKind.VIDEO), "No videos yet"),
    FILES("files", "Files", DocumentScope.All, DocumentFilter.FILES, SearchScope.Kind(DocumentKind.FILE), "No files yet"),
    RECENT("recent", "Recently added", DocumentScope.All, DocumentFilter.ALL, SearchScope.Library, "No files yet", FeedStyle.FOLDS),
    UNFILED(
        "unfiled", "Not in a folder", DocumentScope.TopLevel, DocumentFilter.ALL, SearchScope.Library,
        "Everything is in a folder", FeedStyle.ROWS,
    ),
    ;

    /**
     * The kind this list holds all of. Its count is the server's count of that kind, the figure the Library
     * shows, rather than what the list's own pages add up to.
     */
    val countedKind: DocumentKind?
        get() = DocumentKind.entries.firstOrNull { of(it) == this }

    /** The line under the title for a list of [total] documents; null when this list shows none. */
    fun subtitle(total: Int): String? = when (this) {
        PHOTOS -> count(total, "photo")
        VIDEOS -> count(total, "video")
        FILES, UNFILED -> count(total, "file")
        RECENT -> null
    }

    companion object {
        fun of(kind: DocumentKind): FeedSource = when (kind) {
            DocumentKind.IMAGE -> PHOTOS
            DocumentKind.VIDEO -> VIDEOS
            DocumentKind.FILE -> FILES
        }

        /** The list a route argument names; anything else opens the photos, so a bad link never crashes. */
        fun ofArgument(argument: String?): FeedSource =
            entries.firstOrNull { it.argument.equals(argument, ignoreCase = true) } ?: PHOTOS

        private fun count(n: Int, one: String): String = if (n == 1) "1 $one" else "$n ${one}s"
    }
}
