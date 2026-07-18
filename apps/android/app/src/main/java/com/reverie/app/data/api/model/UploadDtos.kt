package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable

@Serializable
data class UploadedDocument(
    val id: String,
    val original_filename: String,
    val mime_type: String,
    val size_bytes: Long,
    val folder_id: String? = null,
    val file_path: String,
    val created_at: String,
)

@Serializable
data class UploadResponse(
    val session_id: String,
    val documents: List<UploadedDocument>,
    val jobs: List<JobDto>,
)
