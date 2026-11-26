package com.reverie.app.ui.navigation

import android.net.Uri
import androidx.navigation.NavType
import androidx.navigation.navArgument
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.screens.browse.FeedSource

/** The app's destinations, and the arguments each one takes. */
object Routes {
    const val LIBRARY = "library"
    const val PHOTOS = "photos"

    const val FOLDER = "folder/{folderId}"
    val folderArguments = listOf(navArgument("folderId") { type = NavType.StringType })
    fun folder(folderId: String) = "folder/$folderId"

    /** A list of documents as its own screen: one kind of the library, Recently added or "Not in a folder". */
    const val FEED = "list/{source}"
    val feedArguments = listOf(navArgument("source") { type = NavType.StringType })
    fun feed(source: FeedSource) = "list/${source.argument}"

    /** The Photos tab is the list of all photos and videos. */
    val photosArguments = listOf(
        navArgument("source") { type = NavType.StringType; defaultValue = FeedSource.MEDIA.argument },
    )

    const val FAVOURITES = "favourites"

    private const val SEARCH_PATH = "search"
    const val SEARCH = "$SEARCH_PATH?folder={folder}&media={media}&q={q}"
    val searchArguments = listOf(
        navArgument("folder") { type = NavType.StringType; nullable = true; defaultValue = null },
        navArgument("media") { type = NavType.BoolType; defaultValue = false },
        navArgument("q") { type = NavType.StringType; defaultValue = "" },
    )

    /** Search looking in [scope], with [query] already typed. */
    fun search(scope: SearchScope = SearchScope.Library, query: String = ""): String {
        val params = listOfNotNull(
            scope.folderId?.let { "folder=$it" },
            "media=true".takeIf { scope.isMediaOnly },
            query.takeIf { it.isNotEmpty() }?.let { "q=${Uri.encode(it)}" },
        )
        return if (params.isEmpty()) SEARCH_PATH else "$SEARCH_PATH?${params.joinToString("&")}"
    }

    // `from` is the back-stack entry id of the screen whose list opened the viewer (see LocalDiveOrigin): the
    // viewer grows out of its tile and it scrolls on return. A value that is no entry's id when no list did.
    // Optional `ar` (aspect ratio) lets the document-open container transform size itself correctly
    // from the very first frame instead of waiting for the record to load.
    const val DOCUMENT = "document/{id}?from={from}&ar={ar}"
    val documentArguments = listOf(
        navArgument("id") { type = NavType.StringType },
        navArgument("from") { type = NavType.StringType },
        navArgument("ar") { type = NavType.FloatType; defaultValue = -1f },
    )
    fun document(id: String, from: String, aspect: Float? = null) =
        "document/$id?from=$from" + (aspect?.let { "&ar=$it" } ?: "")

    const val SETTINGS = "settings"
    const val SETTINGS_PASSWORD = "settings/password"
    const val SETTINGS_BACKUP = "settings/backup"

    /** The places the library is browsed from: the bottom pill floats over these and no others. */
    val pillRoutes = setOf(LIBRARY, PHOTOS, FOLDER, FEED, FAVOURITES)

    /** Where the pill has the round whole-library search button beside it; other lists search what they show. */
    val searchButtonRoutes = setOf(LIBRARY, FAVOURITES)
}
