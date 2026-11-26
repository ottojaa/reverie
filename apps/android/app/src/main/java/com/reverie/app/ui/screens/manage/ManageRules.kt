package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.domain.FolderTree
import com.reverie.app.domain.counted

/** What the user is asked before [Picked] goes to Trash. */
data class TrashQuestion(val title: String, val message: String)

/** Every delete outside Trash asks this: what goes, and that it can be restored. */
fun trashQuestion(picked: Picked): TrashQuestion {
    val folder = picked.onlyFolder
    if (folder != null) {
        return TrashQuestion("Move “${folder.name}” to Trash?", folderContents(folder) + " You can restore it from Trash.")
    }
    val document = picked.documents.singleOrNull()?.takeIf { picked.count == 1 }
    if (document != null) return TrashQuestion("Move “${document.filename}” to Trash?", "You can restore it from Trash.")

    val named = listOf(picked.folders.size to "folder", picked.documents.size to "file")
        .filter { (count, _) -> count > 0 }
        .joinToString(" and ") { (count, noun) -> counted(count, noun) }
    val contents = when (picked.folders.size) {
        0 -> ""
        1 -> "Everything in the folder goes with it. "
        else -> "Everything in the folders goes with them. "
    }
    return TrashQuestion("Move $named to Trash?", contents + "You can restore them from Trash.")
}

/**
 * What deleting [folder] sends to Trash, counted over everything beneath it. A folder's own counts stop at a
 * private folder inside it, so those are added from the private folder's counts; a locked one shows nothing it
 * holds and is only named.
 */
private fun folderContents(folder: FolderWithChildren): String {
    if (folder.locked) return "Everything locked inside it goes to Trash with it."
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
    return "$list $goes to Trash with it."
}
