package com.reverie.app.ui.screens.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.reverie.app.data.upload.HashProgress
import com.reverie.app.domain.upload.ContentFinding
import com.reverie.app.domain.upload.NameStrategy
import com.reverie.app.domain.upload.keptItems
import com.reverie.app.domain.upload.needsNameChoice
import com.reverie.app.ui.components.LIBRARY_NAME
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.util.formatBytes

/** A file picked or shared for upload, as far as its URI tells. */
data class PickedFile(val uri: Uri, val name: String, val mimeType: String?, val sizeBytes: Long?)

/** An upload being put together on the upload screen. */
data class ReviewState(
    val files: List<PickedFile>,
    /** Where the files go; null is the Library, outside every folder. */
    val folderId: String? = null,
    val folderName: String = LIBRARY_NAME,
    /** Hashing the files / asking the server about them; null when not checking. */
    val checking: HashProgress? = null,
    /** Files whose content or name is already in the library, awaiting a decision. Empty: nothing to ask. */
    val findings: List<ContentFinding> = emptyList(),
    /** Indexes (into [files]) of content matches the person chose to upload anyway; the rest are skipped. */
    val uploadAnyway: Set<Int> = emptySet(),
    val nameStrategy: NameStrategy = NameStrategy.REPLACE,
    /** Files that couldn't be read for hashing, so were compared by name only. */
    val unhashed: Int = 0,
    /** The files are being copied aside for the upload; the screen closes once they are. */
    val isStarting: Boolean = false,
    val error: String? = null,
) {
    val isBusy: Boolean get() = checking != null || isStarting

    /** The files that stay in the upload as the findings are answered. */
    val kept: List<PickedFile> get() = keptItems(files, findings, uploadAnyway)

    val asksStrategy: Boolean get() = findings.any { needsNameChoice(it, it.index in uploadAnyway) }
}

/** "Photo · 3.1 MB", or "PDF · 240 KB" for what is neither a photo nor a video. */
fun toFileMeta(file: PickedFile): String {
    val mimeType = file.mimeType.orEmpty()
    val kind = when {
        mimeType.startsWith("image/") -> "Photo"
        mimeType.startsWith("video/") -> "Video"
        else -> fileTypeLabel(mimeType, file.name)
    }
    return listOfNotNull(kind, file.sizeBytes?.let(::formatBytes)).joinToString(" · ")
}

/** "3 files · 5.8 MB"; no size unless every file's is known. */
fun toSelectionSummary(files: List<PickedFile>): String {
    val count = if (files.size == 1) "1 file" else "${files.size} files"
    val sizes = files.mapNotNull { it.sizeBytes }
    return if (sizes.size < files.size) count else "$count · ${formatBytes(sizes.sum())}"
}

/** What the content resolver says about [uri]; its last path segment names it when that is nothing. */
fun Context.toPickedFile(uri: Uri): PickedFile {
    val fallback = PickedFile(uri, uri.lastPathSegment ?: "file", runCatching { contentResolver.getType(uri) }.getOrNull(), null)
    return runCatching {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val name = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val size = cursor.getColumnIndex(OpenableColumns.SIZE)
            fallback.copy(
                name = if (name >= 0 && !cursor.isNull(name)) cursor.getString(name) else fallback.name,
                sizeBytes = if (size >= 0 && !cursor.isNull(size)) cursor.getLong(size) else null,
            )
        }
    }.getOrNull() ?: fallback
}
