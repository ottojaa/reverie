package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.domain.CachedFolders
import com.reverie.app.ui.screens.manage.Picked
import com.reverie.app.ui.screens.manage.toPicked

/**
 * What [ids] picks out of the favourites listed in [items]. A private one tells nothing of itself, so it can
 * only be unstarred.
 */
internal fun pickFavourites(ids: Set<String>, items: List<FavouriteDto>, folders: CachedFolders): Picked {
    if (ids.isEmpty()) return Picked()
    val (hidden, open) = items.filter { it.id in ids }.partition { it.isPrivate }
    return Picked(
        documents = open.mapNotNull { it.document?.toPicked() },
        folders = open.filter { it.type == FavouriteType.FOLDER }.mapNotNull { folders.byId[it.id] ?: it.folder },
        locked = hidden.map { it.key },
    )
}
