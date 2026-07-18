package com.reverie.app.data.api

import com.reverie.app.data.api.model.FacetsResponse
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.data.api.model.SearchHelp
import com.reverie.app.data.api.model.SearchResponse
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun search(
        q: String,
        limit: Int,
        offset: Int,
        sortBy: String,
        sortOrder: String,
        includeFacets: Boolean,
    ): SearchResponse = client.get("search") {
        parameter("q", q)
        parameter("limit", limit)
        parameter("offset", offset)
        parameter("sort_by", sortBy)
        parameter("sort_order", sortOrder)
        parameter("include_facets", includeFacets)
    }.decode()

    suspend fun facets(q: String): SearchFacets = client.get("search/facets") {
        parameter("q", q)
    }.decode<FacetsResponse>().facets

    suspend fun suggest(type: String, q: String, limit: Int = 10): List<String> = client.get("search/suggest") {
        parameter("type", type)
        parameter("q", q)
        parameter("limit", limit)
    }.decode()

    suspend fun quickFilters(): List<QuickFilter> = client.get("search/quick-filters").decode()

    suspend fun help(): SearchHelp = client.get("search/help").decode()
}
