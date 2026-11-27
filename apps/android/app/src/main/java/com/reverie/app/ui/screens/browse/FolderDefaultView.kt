package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.kind

/** Whether the documents counted are photos and videos only, at least one. */
val DocumentSummaryDto.isAllMedia: Boolean get() = file.count == 0 && image.count + video.count > 0

/** [isAllMedia] as far as the [cached] rows show it: what is left to go by when the server can't be asked. */
internal fun isAllMedia(cached: List<DocumentDto>): Boolean =
    cached.isNotEmpty() && cached.none { it.kind == DocumentKind.FILE }

/**
 * Whether a folder's own documents are all photos and videos, as far as that is already certain; null when
 * only the server's summary can tell. Cached rows alone prove nothing: the Photos tab caches photos of
 * every folder, so a mixed folder whose other files were never read looks like a folder of photos.
 *
 * @param summary the server's figures for the folder's own documents, if they were read before.
 * @param folder the folder in the cached tree. Its counts include the folders beneath it, and are all zero
 *   while it is locked.
 * @param cached the folder's own documents in the cache.
 */
internal fun knownAllMedia(summary: DocumentSummaryDto?, folder: FolderWithChildren?, cached: List<DocumentDto>): Boolean? {
    if (summary != null) return summary.isAllMedia
    val counts = folder?.kind_counts?.takeIf { it.image + it.video + it.file > 0 }
    if (counts != null && folder.children.isEmpty()) return counts.file == 0
    if (cached.any { it.kind == DocumentKind.FILE }) return false
    return true.takeIf { counts?.file == 0 && cached.isNotEmpty() }
}
