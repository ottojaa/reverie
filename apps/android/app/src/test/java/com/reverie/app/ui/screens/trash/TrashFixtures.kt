package com.reverie.app.ui.screens.trash

import com.reverie.app.data.api.model.ThumbnailUrls
import com.reverie.app.data.api.model.TrashDocumentDto
import com.reverie.app.data.api.model.TrashFolderDto
import java.time.Instant
import java.time.temporal.ChronoUnit

/** A purge date [days] from now. */
internal fun purgingIn(days: Long): String = Instant.now().plus(days, ChronoUnit.DAYS).toString()

internal fun trashedFile(
    id: String,
    name: String = "$id.pdf",
    purgeAt: String = purgingIn(27),
    thumbnails: ThumbnailUrls? = null,
) = TrashDocumentDto(
    id = id, original_filename = name, mime_type = "application/pdf", size_bytes = 2_411_724, folder_id = null,
    is_private = false, thumbnail_blurhash = null, thumbnail_urls = thumbnails,
    deleted_at = "2026-11-01T00:00:00Z", purge_at = purgeAt,
)

/** A locked folder is listed as the server sends it: no name, nothing counted. */
internal fun trashedFolder(
    id: String,
    folders: Int = 0,
    files: Int = 0,
    name: String = id,
    locked: Boolean = false,
    purgeAt: String = purgingIn(27),
) = TrashFolderDto(
    id = id, name = if (locked) "" else name, emoji = null, is_private = locked, locked = locked,
    folder_count = if (locked) 0 else folders, document_count = if (locked) 0 else files,
    deleted_at = "2026-11-01T00:00:00Z", purge_at = purgeAt,
)
