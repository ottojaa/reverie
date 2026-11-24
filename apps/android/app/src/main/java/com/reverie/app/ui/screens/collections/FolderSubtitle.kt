package com.reverie.app.ui.screens.collections

import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.ui.components.fileTypeLabel

private const val MAX_TYPES_SHOWN = 3

/**
 * What a folder row says under its name, from the folder's own summary: "25 photos", "13 files · TS,
 * JSON, MD", "91 files · APK", "Empty". The type labels are the dashboard's rule ([fileTypeLabel]),
 * so a document reads the same here as in the file rows. Without a cover (offline, or a server from
 * before covers) it falls back to the cached [documentCount].
 */
fun folderSubtitle(cover: FolderCoverDto?, documentCount: Int): String {
    if (cover == null) return if (documentCount == 0) "Empty" else plural(documentCount, "file")

    val summary = cover.summary
    val images = summary.image.count
    val videos = summary.video.count
    val files = summary.file.count
    val total = images + videos + files

    if (total == 0) return "Empty"
    if (total == images) return plural(images, "photo")
    if (total == videos) return plural(videos, "video")

    val count = plural(total, "file")
    val types = summary.file.top_types
        .map { fileTypeLabel(mime = "", filename = "file.${it.ext}") }
        .distinct()
        .take(MAX_TYPES_SHOWN)
    if (types.isEmpty()) return count

    return count + " · " + types.joinToString(", ")
}

private fun plural(count: Int, noun: String): String = if (count == 1) "1 $noun" else "$count ${noun}s"
