package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.components.fileTypeLabel

/** A favourite's name. A private one never says its own. */
fun favouriteName(item: FavouriteDto): String {
    if (item.isPrivate) return "Private"
    return item.folder?.name ?: item.document?.original_filename.orEmpty()
}

/** Under a private favourite: what a tap will do. */
fun privateLine(item: FavouriteDto): String = if (item.locked) "Unlock to see" else "Tap to open"

/** Under a folder: what it holds, and the folder it is in unless it is at the top. */
fun folderLine(folder: FolderWithChildren, item: FavouriteDto): String {
    val meta = folderMeta(folder)
    val parent = item.location?.lastOrNull() ?: return meta
    return "$meta · in ${parent.name}"
}

/** Under a folder the cached tree does not hold, so what is in it is not known: only the folder it is in. */
fun uncachedFolderLine(item: FavouriteDto): String = item.location?.lastOrNull()?.let { "in ${it.name}" }.orEmpty()

/** Under a file: its type, and the folders down to it unless it is at the top level. */
fun fileLine(document: DocumentDto, item: FavouriteDto): String {
    val type = fileTypeLabel(document.mime_type, document.original_filename)
    val path = item.location.orEmpty().joinToString(" › ") { it.name }
    return if (path.isEmpty()) type else "$type · $path"
}
