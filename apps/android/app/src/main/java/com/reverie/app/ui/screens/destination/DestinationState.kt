package com.reverie.app.ui.screens.destination

import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.FolderTree
import com.reverie.app.domain.isInPrivateTree
import com.reverie.app.ui.components.LIBRARY_NAME

/** What a destination browser may pick. */
data class DestinationRules(
    /** Folders that are neither listed nor opened: a folder being moved, with everything in it. */
    val excluded: Set<String> = emptySet(),
    val allowPrivate: Boolean = true,
    /** Whether the Library itself, outside every folder, can be picked. */
    val allowTop: Boolean = true,
) {
    fun offers(folder: FolderWithChildren): Boolean =
        folder.id !in excluded && (allowPrivate || !folder.isInPrivateTree)
}

/** The picked place: a folder, or the Library itself when [folderId] is null. */
data class Destination(val folderId: String?, val name: String)

data class DestinationState(
    val tree: FolderTree,
    val rules: DestinationRules,
    /** The folder being looked at; null for the top level. */
    val at: String? = null,
    /** What is typed into the search field; null while it is closed. */
    val query: String? = null,
    val covers: Map<String, FolderCoverDto> = emptyMap(),
    val isLoading: Boolean = false,
    val error: String? = null,
) {
    /** From the top level down to the folder being looked at. */
    val path: List<FolderWithChildren> = tree.pathTo(at)
    val current: FolderWithChildren? = path.lastOrNull()
    val isSearching: Boolean = !query.isNullOrBlank()

    /** The folders listed: the ones in the current folder, or every match anywhere while searching. */
    val rows: List<FolderWithChildren> = if (isSearching) {
        tree.all().filter { rules.offers(it) && it.name.contains(query.orEmpty().trim(), ignoreCase = true) }
    } else {
        tree.childrenOf(current?.id).filter(rules::offers)
    }

    val destination: Destination = Destination(current?.id, current?.name ?: LIBRARY_NAME)
    val canSelect: Boolean = current != null || rules.allowTop

    /** Where [folder] sits, for telling apart search results that share a name. */
    fun locationOf(folder: FolderWithChildren): String =
        (listOf(LIBRARY_NAME) + tree.pathTo(folder.parent_id).map { it.name }).joinToString(" › ")
}
