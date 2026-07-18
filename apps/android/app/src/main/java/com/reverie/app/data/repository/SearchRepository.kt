package com.reverie.app.data.repository

import com.reverie.app.data.api.SearchApi
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.SearchFacets
import com.reverie.app.data.api.model.SearchResponse
import com.reverie.app.data.local.dao.SearchHistoryDao
import com.reverie.app.data.local.entity.SearchHistoryEntity
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchRepository @Inject constructor(
    private val searchApi: SearchApi,
    private val searchHistoryDao: SearchHistoryDao,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    fun observeRecent(): Flow<List<String>> =
        searchHistoryDao.observeRecent().map { rows -> rows.map { it.query } }

    suspend fun search(
        q: String,
        limit: Int,
        offset: Int,
        sortBy: String,
        sortOrder: String,
        includeFacets: Boolean,
    ): SearchResponse = withContext(io) {
        searchApi.search(q, limit, offset, sortBy, sortOrder, includeFacets)
    }

    suspend fun facets(q: String): SearchFacets = withContext(io) { searchApi.facets(q) }

    suspend fun suggest(type: String, q: String): List<String> = withContext(io) {
        runCatching { searchApi.suggest(type, q) }.getOrDefault(emptyList())
    }

    suspend fun quickFilters(): List<QuickFilter> = withContext(io) {
        runCatching { searchApi.quickFilters() }.getOrDefault(emptyList())
    }

    suspend fun recordSearch(query: String) = withContext(io) {
        val trimmed = query.trim()
        if (trimmed.isBlank()) return@withContext
        val count = (searchHistoryDao.useCountOf(trimmed) ?: 0) + 1
        searchHistoryDao.upsert(SearchHistoryEntity(trimmed, System.currentTimeMillis(), count))
    }

    suspend fun removeRecent(query: String) = withContext(io) { searchHistoryDao.delete(query) }
}
