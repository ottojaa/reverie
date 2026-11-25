package com.reverie.app.data.api

import com.reverie.app.data.api.model.FacetsResponse
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.data.api.model.SearchHelp
import com.reverie.app.data.api.model.SearchResponse
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchApi @Inject constructor(
    private val client: HttpClient,
) {
    /**
     * Matches of [q] in the whole library, narrowed to [folderId] and everything beneath it, or with
     * [media] to photos and videos.
     */
    suspend fun search(
        q: String,
        limit: Int,
        offset: Int,
        sortBy: String,
        sortOrder: String,
        includeFacets: Boolean,
        folderId: String? = null,
        media: Boolean = false,
    ): SearchResponse = client.get("search") {
        parameter("q", q)
        parameter("limit", limit)
        parameter("offset", offset)
        parameter("sort_by", sortBy)
        parameter("sort_order", sortOrder)
        parameter("include_facets", includeFacets)
        narrowedTo(folderId, media)
    }.decode()

    suspend fun facets(q: String, folderId: String? = null, media: Boolean = false): SearchFacets =
        client.get("search/facets") {
            parameter("q", q)
            narrowedTo(folderId, media)
        }.decode<FacetsResponse>().facets

    suspend fun suggest(type: String, q: String, limit: Int = 10): List<String> = client.get("search/suggest") {
        parameter("type", type)
        parameter("q", q)
        parameter("limit", limit)
    }.decode()

    suspend fun quickFilters(): List<QuickFilter> = client.get("search/quick-filters").decode()

    suspend fun help(): SearchHelp = client.get("search/help").decode()
}

private fun HttpRequestBuilder.narrowedTo(folderId: String?, media: Boolean) {
    folderId?.let { parameter("folder_id", it) }
    if (media) parameter("media", true)
}
