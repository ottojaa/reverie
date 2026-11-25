package com.reverie.app.data.repository

import androidx.compose.runtime.Immutable
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType

/** One change of one star made on this device. Compared by identity: each tap is its own edit. */
class FavouriteEdit(val key: FavouriteKey, val isStarred: Boolean)

/**
 * What the phone knows about favourites: the last list the server sent, with this device's changes
 * on top. [pending] edits are on their way to the server; [confirmed] ones were accepted but no list
 * fetched since reflects them yet.
 */
@Immutable
data class FavouritesState(
    /** Null until a list has been fetched. */
    val items: List<FavouriteDto>? = null,
    val pending: List<FavouriteEdit> = emptyList(),
    val confirmed: Map<FavouriteKey, FavouriteEdit> = emptyMap(),
    /** Goes up on logout, so an answer to a request made before it is dropped. */
    val session: Int = 0,
) {
    val isLoaded: Boolean get() = items != null

    private val listed: Set<FavouriteKey> by lazy { items.orEmpty().map { it.key }.toSet() }

    private val edits: Map<FavouriteKey, Boolean> by lazy {
        (confirmed.values + pending).associate { it.key to it.isStarred }
    }

    /**
     * The favourites to draw, newest-starred first. Cards come only from the server's list: an
     * unstarred one leaves at once, a newly starred one appears with the next fetch.
     */
    val visible: List<FavouriteDto> by lazy { items.orEmpty().filter { isStarred(it.key) } }

    val starredDocumentIds: Set<String> by lazy { starredIds(FavouriteType.DOCUMENT) }

    val starredFolderIds: Set<String> by lazy { starredIds(FavouriteType.FOLDER) }

    fun isStarred(key: FavouriteKey): Boolean = edits[key] ?: (key in listed)

    private fun starredIds(type: FavouriteType): Set<String> =
        (listed + edits.keys).filter { it.type == type && isStarred(it) }.map { it.id }.toSet()
}
