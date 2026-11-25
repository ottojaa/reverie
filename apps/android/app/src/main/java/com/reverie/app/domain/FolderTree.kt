package com.reverie.app.domain

import com.reverie.app.data.api.model.FolderWithChildren

/** The library's folders, nested to any depth as GET /folders/tree returns them, with lookups. */
class FolderTree(val roots: List<FolderWithChildren>) {
    private val byId: Map<String, FolderWithChildren> = roots.withDescendants().associateBy { it.id }

    fun find(id: String): FolderWithChildren? = byId[id]

    /** The folders directly inside [id]; the top-level folders for null. */
    fun childrenOf(id: String?): List<FolderWithChildren> = if (id == null) roots else byId[id]?.children.orEmpty()

    /** The folders from the top level down to [id], which comes last. Empty for null or an unknown id. */
    fun pathTo(id: String?): List<FolderWithChildren> =
        generateSequence(id?.let(byId::get)) { folder -> folder.parent_id?.let(byId::get) }.toList().asReversed()

    /** [id] and every folder beneath it; just [id] when it is unknown. */
    fun subtreeIds(id: String): Set<String> =
        byId[id]?.let { folder -> listOf(folder).withDescendants().mapTo(mutableSetOf()) { it.id } } ?: setOf(id)

    /** Every folder, parents before their children. */
    fun all(): List<FolderWithChildren> = byId.values.toList()
}

private fun List<FolderWithChildren>.withDescendants(): List<FolderWithChildren> =
    flatMap { listOf(it) + it.children.withDescendants() }

/** Private by its own flag or through a folder above it; the lock may be open. */
val FolderWithChildren.isInPrivateTree: Boolean get() = is_private || lock_id != null

/**
 * The line under a folder's name, the same wherever the folder is shown: what is directly inside it as
 * folders, and its documents including those further down ("5 folders · 27 photos"). A mix that holds
 * anything but photos and videos is counted as files.
 */
fun folderMeta(folder: FolderWithChildren): String {
    if (folder.locked) return "Locked"
    val (images, videos, files) = folder.kind_counts
    val documents = if (files > 0) {
        listOf(counted(images + videos + files, "file"))
    } else {
        listOfNotNull(counted(images, "photo").takeIf { images > 0 }, counted(videos, "video").takeIf { videos > 0 })
    }
    val folders = listOfNotNull(counted(folder.children.size, "folder").takeIf { folder.children.isNotEmpty() })
    return (folders + documents).joinToString(" · ").ifEmpty { "Empty" }
}

private fun counted(count: Int, noun: String): String = if (count == 1) "1 $noun" else "$count ${noun}s"
