package com.reverie.app.domain.model

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.model.EntityDto
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Typed view over the loosely-typed `llm_metadata` column (camelCase, matching the backend
 * `EnhancedMetadata`). Decoded leniently so shape drift never throws — see [from].
 */
@Serializable
data class LlmMetadata(
    val type: String? = null,
    val title: String? = null,
    val language: String? = null,
    val entities: List<EntityDto> = emptyList(),
    val topics: List<String> = emptyList(),
    val documentType: String? = null,
    val extractedDate: String? = null,
    val extractedDates: List<ExtractedDate> = emptyList(),
    val keyValues: List<KeyValue> = emptyList(),
    val tableData: List<TableRow> = emptyList(),
) {
    companion object {
        fun from(json: JsonObject?): LlmMetadata? {
            if (json == null) return null
            return runCatching { ApiJson.decodeFromJsonElement(serializer(), json) }.getOrNull()
        }
    }
}

@Serializable
data class ExtractedDate(val date: String, val context: String = "")

@Serializable
data class KeyValue(val label: String, val value: String)

@Serializable
data class TableRow(val item: String, val columns: Map<String, String> = emptyMap())
