package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class JobDto(
    val id: String,
    val job_type: JobType,
    val target_type: TargetType,
    val target_id: String,
    val status: JobStatus,
    val priority: Int = 0,
    val attempts: Int = 0,
    val error_message: String? = null,
    val result: JsonElement? = null,
    val created_at: String,
    val started_at: String? = null,
    val completed_at: String? = null,
)

@Serializable
data class JobBatchItem(
    val id: String,
    val status: JobStatus,
    val progress: Double? = null,
)

@Serializable
data class JobIdResponse(
    val job_id: String,
    val status: JobStatus,
)
