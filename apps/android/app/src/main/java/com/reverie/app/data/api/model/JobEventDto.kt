package com.reverie.app.data.api.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
enum class JobEventType(val wire: String) {
    @SerialName("job:started") STARTED("job:started"),
    @SerialName("job:progress") PROGRESS("job:progress"),
    @SerialName("job:complete") COMPLETE("job:complete"),
    @SerialName("job:failed") FAILED("job:failed"),
}

/** Payload of the Socket.IO `job:*` events. */
@Serializable
data class JobEventDto(
    val type: JobEventType,
    val job_id: String,
    val document_id: String? = null,
    val folder_id: String? = null,
    val session_id: String? = null,
    val status: JobStatus,
    val progress: Double? = null,
    val error_message: String? = null,
    val result: JsonElement? = null,
    val timestamp: String,
)
