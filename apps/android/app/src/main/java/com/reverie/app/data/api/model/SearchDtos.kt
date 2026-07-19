package com.reverie.app.data.api.model

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonClassDiscriminator

/** Documents and collections interleave in one result list, keyed by `result_type`. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("result_type")
sealed interface SearchHit

@Serializable
@SerialName("document")
data class DocumentSearchResult(
    val document_id: String,
    val display_name: String,
    val filename: String,
    val folder_path: String? = null,
    val folder_id: String? = null,
    val uploaded_at: String,
    val extracted_date: String? = null,
    val category: DocumentCategory? = null,
    val mime_type: String,
    val format: String,
    val snippet: String? = null,
    val has_text: Boolean,
    val thumbnail_urls: ThumbnailUrls? = null,
    val blurhash: String? = null,
    val size_bytes: Long,
    // Video length in seconds; null for non-video hits.
    val duration_seconds: Double? = null,
    val tags: List<String> = emptyList(),
    val relevance: Double? = null,
) : SearchHit

@Serializable
@SerialName("collection")
data class CollectionSearchResult(
    val id: String,
    val name: String,
    val path: String,
    val description: String? = null,
    val emoji: String? = null,
    val folder_type: FolderType,
    val document_count: Int,
    val snippet: String? = null,
    val relevance: Double? = null,
) : SearchHit

@Serializable
data class FacetItem(
    val name: String,
    val count: Int,
    val selected: Boolean? = null,
)

@Serializable
data class SearchFacets(
    val types: List<FacetItem> = emptyList(),
    val formats: List<FacetItem> = emptyList(),
    val folders: List<FacetItem> = emptyList(),
    val uploadPeriod: List<FacetItem> = emptyList(),
    val tags: List<FacetItem> = emptyList(),
    val hasText: List<FacetItem> = emptyList(),
    val categories: List<FacetItem> = emptyList(),
    val entities: List<FacetItem>? = null,
    val locations: List<FacetItem>? = null,
)

@Serializable
data class SearchResponse(
    val total: Int,
    val results: List<SearchHit> = emptyList(),
    val facets: SearchFacets? = null,
    // ParsedQuery is a debug echo; kept opaque on the client.
    val query: JsonObject? = null,
    val timing_ms: Double,
)

@Serializable
data class FacetsResponse(val facets: SearchFacets)

@Serializable
data class QuickFilter(
    val id: String,
    val label: String,
    val query: String,
    val icon: String? = null,
    val count: Int,
)

@Serializable
data class SearchHelpFilter(
    val name: String,
    val syntax: String,
    val examples: List<String>,
    val description: String,
)

@Serializable
data class SearchHelpExample(val query: String, val description: String)

@Serializable
data class SearchHelp(
    val filters: List<SearchHelpFilter>,
    val examples: List<SearchHelpExample>,
)
