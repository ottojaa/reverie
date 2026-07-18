package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Generic API error envelope: `{ statusCode, error, message, details? }`. */
@Serializable
data class ApiErrorDto(
    val statusCode: Int? = null,
    val error: String? = null,
    val message: String? = null,
    val details: JsonObject? = null,
)

/** Offset/limit paginated list — `{ items, total, limit, offset }`. */
@Serializable
data class Paginated<T>(
    val items: List<T>,
    val total: Int,
    val limit: Int,
    val offset: Int,
)
