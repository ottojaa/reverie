package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.util.formatBytes

/** A favourite's name. A private one never says its own. */
fun favouriteName(item: FavouriteDto): String {
    if (item.isPrivate) return "Private"
    return item.folder?.name ?: item.document?.original_filename.orEmpty()
}

/** The line under a shelf card: what it is and where it lives. */
fun shelfSubtitle(item: FavouriteDto): String {
    if (item.isPrivate) return privateSubtitle(item)
    val folder = item.folder ?: return withPlace("File", item.location.orEmpty().joinToString(" / ") { it.name })
    if (folder.type == FolderType.COLLECTION) return "Collection"
    return withPlace("Folder", item.location?.firstOrNull()?.name.orEmpty())
}

/** The line under a card on the Favourites screen: a file says its type and size instead of its place. */
fun gridSubtitle(item: FavouriteDto): String {
    val document = item.document ?: return shelfSubtitle(item)
    return fileTypeLabel(document.mime_type, document.original_filename) + " · " + formatBytes(document.size_bytes)
}

private fun privateSubtitle(item: FavouriteDto): String = if (item.locked) "Unlock to see" else "Tap to open"

private fun withPlace(kind: String, place: String): String = if (place.isEmpty()) kind else "$kind · $place"
