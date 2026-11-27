package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus

/** A document with only what Browse looks at: its kind (by [mime]), upload time and date taken. */
fun doc(
    id: String,
    mime: String = "image/jpeg",
    created: String = "2026-11-23T10:00:00Z",
    taken: String? = null,
    name: String = "$id.bin",
    bytes: Long = 1,
): DocumentDto = DocumentDto(
    id = id, file_path = "/$id", file_hash = "h-$id", original_filename = name, mime_type = mime,
    size_bytes = bytes, ocr_status = JobStatus.COMPLETE, thumbnail_status = JobStatus.COMPLETE,
    llm_status = JobStatus.COMPLETE, is_private = false, created_at = created, updated_at = created,
    taken_at = taken,
)
