package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.FolderTree

/** The most documents one move request may name. */
private const val MOVE_LIMIT = 100

/** What a move or a delete needs to know of one document. */
data class PickedDocument(val id: String, val folderId: String?, val filename: String)

fun DocumentDto.toPicked() = PickedDocument(id, folder_id, original_filename)

/**
 * What a screen's selection holds, found among what the screen lists. [locked] are favourites behind a closed
 * lock: nothing is known of them, so they can only be unstarred.
 */
data class Picked(
    val documents: List<PickedDocument> = emptyList(),
    val folders: List<FolderWithChildren> = emptyList(),
    val locked: List<FavouriteKey> = emptyList(),
) {
    val keys: List<FavouriteKey>
        get() = documents.map { FavouriteKey(FavouriteType.DOCUMENT, it.id) } +
            folders.map { FavouriteKey(FavouriteType.FOLDER, it.id) } +
            locked

    val ids: Set<String> get() = keys.mapTo(mutableSetOf()) { it.id }
    val count: Int get() = documents.size + folders.size + locked.size
    val isEmpty: Boolean get() = count == 0

    /** The folder when it is the only thing selected: the one case with a folder's own actions. */
    val onlyFolder: FolderWithChildren? get() = folders.singleOrNull()?.takeIf { count == 1 }
}

/** What [ids] picks out of the listed [documents] and [folders]. */
fun pickFrom(
    ids: Set<String>,
    documents: List<DocumentDto> = emptyList(),
    folders: List<FolderWithChildren> = emptyList(),
): Picked {
    if (ids.isEmpty()) return Picked()
    return Picked(
        documents = documents.filter { it.id in ids }.distinctBy { it.id }.map { it.toPicked() },
        folders = folders.filter { it.id in ids },
    )
}

/** One request of a move or a delete, and every selected id it settles. */
sealed interface PickedStep {
    val settles: Set<String>

    data class Documents(val documents: List<PickedDocument>) : PickedStep {
        override val settles: Set<String> = documents.mapTo(mutableSetOf()) { it.id }
    }

    data class Folder(val folder: FolderWithChildren, override val settles: Set<String>) : PickedStep
}

/**
 * The requests that move or delete [picked]: documents first, then one per folder. What lies inside a picked
 * folder goes with it and gets no request of its own. A [needed] test leaves out what has nothing to be done.
 */
fun toSteps(
    picked: Picked,
    tree: FolderTree,
    isDocumentNeeded: (PickedDocument) -> Boolean = { true },
    isFolderNeeded: (FolderWithChildren) -> Boolean = { true },
): List<PickedStep> {
    // The tree's copy knows the folder's parent; a search hit's stand-in may not.
    val folders = picked.folders.map { tree.find(it.id) ?: it }
    val subtrees = folders.associate { it.id to tree.subtreeIds(it.id) }
    val covered = subtrees.values.flatten().toSet()
    val outermost = folders.filterNot { folder -> subtrees.any { (id, within) -> id != folder.id && folder.id in within } }
    val loose = picked.documents.filterNot { it.folderId in covered }.filter(isDocumentNeeded)

    val folderSteps = outermost.filter(isFolderNeeded).map { folder ->
        val within = subtrees.getValue(folder.id)
        val inside = picked.documents.filter { it.folderId in within }.map { it.id }
        PickedStep.Folder(folder, settles = (inside + folders.map { it.id }.filter { it in within }).toSet())
    }
    return toBatches(loose).map { PickedStep.Documents(it) } + folderSteps
}

/**
 * [documents] split into requests. Documents sharing a name stay in one request: replacing, a later move
 * would trash the namesake an earlier one had just moved.
 */
fun toBatches(documents: List<PickedDocument>): List<List<PickedDocument>> =
    documents.groupBy { it.filename }.values
        .fold(emptyList<List<PickedDocument>>()) { batches, namesakes ->
            val last = batches.lastOrNull()
            if (last == null || last.size + namesakes.size > MOVE_LIMIT) return@fold batches.plusElement(namesakes)
            batches.dropLast(1).plusElement(last + namesakes)
        }
        .flatMap { it.chunked(MOVE_LIMIT) }
