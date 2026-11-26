package com.reverie.app.ui.screens.trash

import com.reverie.app.data.api.model.TrashDocumentDto
import com.reverie.app.data.api.model.TrashFolderDto
import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.data.api.model.TrashSelectionRequest
import com.reverie.app.domain.counted
import com.reverie.app.util.formatBytes
import java.time.Duration
import java.time.Instant
import kotlin.math.ceil

private const val DAY_MILLIS = 86_400_000.0
private const val CANNOT_UNDO = "This can't be undone."

/** One thing in the trash: a file, or a folder standing for everything that went there with it. */
sealed interface TrashItem {
    val id: String
    val name: String
    val purgeAt: String

    data class Folder(val folder: TrashFolderDto) : TrashItem {
        override val id get() = folder.id
        override val name get() = if (folder.locked) "Locked folder" else folder.name
        override val purgeAt get() = folder.purge_at
    }

    data class Document(val document: TrashDocumentDto) : TrashItem {
        override val id get() = document.id
        override val name get() = document.original_filename
        override val purgeAt get() = document.purge_at
    }
}

/** Everything in the trash, folders first. */
fun TrashListDto.toItems(): List<TrashItem> = folders.map(TrashItem::Folder) + documents.map(TrashItem::Document)

fun List<TrashItem>.toSelection() = TrashSelectionRequest(
    document_ids = filterIsInstance<TrashItem.Document>().map { it.id },
    folder_ids = filterIsInstance<TrashItem.Folder>().map { it.id },
)

/** The line under an item's name: what it is, and how long it stays. */
fun trashMeta(item: TrashItem, now: Instant): String {
    val what = when (item) {
        is TrashItem.Document -> formatBytes(item.document.size_bytes)
        is TrashItem.Folder -> if (item.folder.locked) "Locked" else toContents(item.folder).ifEmpty { listOf("Empty") }.joinToString(" · ")
    }
    return listOf(what, toTimeLeft(item.purgeAt, now)).filter { it.isNotEmpty() }.joinToString(" · ")
}

/** What the confirmation asks before [items] are deleted for good. */
fun purgeTitle(items: List<TrashItem>): String {
    val named = items.singleOrNull()?.let { "“${it.name}”" } ?: counted(items.size, "item")
    return "Delete $named forever?"
}

/** What the confirmation says goes when [items] are deleted for good. */
fun purgeMessage(items: List<TrashItem>): String {
    val single = items.singleOrNull()
    if (single != null) return purgeMessage(single)
    return when (items.count { it is TrashItem.Folder }) {
        0 -> CANNOT_UNDO
        1 -> "Everything in the folder is deleted with it. $CANNOT_UNDO"
        else -> "Everything in the folders is deleted with them. $CANNOT_UNDO"
    }
}

private fun purgeMessage(item: TrashItem): String {
    if (item !is TrashItem.Folder) return CANNOT_UNDO
    val contents = toContents(item.folder)
    if (contents.isEmpty()) return CANNOT_UNDO
    val isOne = item.folder.folder_count + item.folder.document_count == 1
    return "The ${contents.joinToString(" and ")} in it ${if (isOne) "is" else "are"} deleted with it. $CANNOT_UNDO"
}

/** "2 folders", "14 files": what a trashed folder holds, leaving out what there is none of. */
private fun toContents(folder: TrashFolderDto): List<String> =
    listOf(folder.folder_count to "folder", folder.document_count to "file")
        .filter { (count, _) -> count > 0 }
        .map { (count, noun) -> counted(count, noun) }

/** Whole days until the server removes the item for good; empty when [purgeAt] is not a time. */
fun toTimeLeft(purgeAt: String, now: Instant): String {
    val until = runCatching { Duration.between(now, Instant.parse(purgeAt)) }.getOrNull() ?: return ""
    val days = ceil(until.toMillis() / DAY_MILLIS).toInt()
    if (days <= 0) return "Removed soon"
    return "${counted(days, "day")} left"
}
