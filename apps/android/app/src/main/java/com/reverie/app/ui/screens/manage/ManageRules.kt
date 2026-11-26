package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.FolderTree
import com.reverie.app.domain.counted

/** The most documents one move request may name. */
private const val MOVE_LIMIT = 100

/**
 * What deleting [folder] sends to the trash, counted over everything beneath it. A folder's own counts stop
 * at a private folder inside it, so those are added from the private folder's counts; a locked one shows
 * nothing it holds and is only named.
 */
fun trashMessage(folder: FolderWithChildren): String {
    if (folder.locked) return "Everything locked inside it goes to the trash with it."
    val tree = FolderTree(listOf(folder))
    val beneath = tree.all().filter { it.id != folder.id }
    val (locked, open) = beneath.partition { it.locked }
    // Where a private folder starts inside a public one, its documents are counted apart.
    val countedApart = open.filter { it.lock_id != folder.lock_id && it.parent_id?.let(tree::find)?.lock_id == folder.lock_id }
    val files = folder.kind_counts.total + countedApart.sumOf { it.kind_counts.total }
    val parts = listOf(open.size to "folder", files to "file", locked.size to "locked folder").filter { (count, _) -> count > 0 }
    if (parts.isEmpty()) return "The folder is empty."
    val named = parts.map { (count, noun) -> counted(count, noun) }
    val list = if (named.size == 1) named.single() else named.dropLast(1).joinToString(", ") + " and " + named.last()
    val goes = if (parts.sumOf { it.first } == 1) "goes" else "go"
    return "$list $goes to the trash with it."
}

/**
 * [documents] split into move requests. Documents sharing a name stay in one request: replacing, a later
 * request would trash the namesake an earlier one had just moved.
 */
fun toMoveBatches(documents: List<DocumentDto>): List<List<DocumentDto>> =
    documents.groupBy { it.original_filename }.values
        .fold(emptyList<List<DocumentDto>>()) { batches, namesakes ->
            val last = batches.lastOrNull()
            if (last == null || last.size + namesakes.size > MOVE_LIMIT) return@fold batches.plusElement(namesakes)
            batches.dropLast(1).plusElement(last + namesakes)
        }
        .flatMap { it.chunked(MOVE_LIMIT) }
