package com.reverie.app.data.repository

import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.entity.DocumentEntity
import com.reverie.app.data.local.toDto
import com.reverie.app.data.local.toEntity
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** One page of a refresh: the server total and how many rows we've loaded so far. */
data class PageResult(val total: Int, val loaded: Int) {
    val hasMore: Boolean get() = loaded < total
}

/**
 * Stale-while-revalidate access to documents. Room is the display source of truth; the
 * network refreshes it. Signed file/thumbnail URLs are never persisted (see [toEntity]).
 */
@Singleton
class DocumentRepository @Inject constructor(
    private val documentDao: DocumentDao,
    private val documentsApi: DocumentsApi,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    /** Cached documents for the grid. `folderId == null` is the all-documents view. */
    fun observeDocuments(folderId: String?): Flow<List<DocumentDto>> {
        val source = if (folderId == null) documentDao.observeAll() else documentDao.observeByFolder(folderId)
        return source.map { rows -> rows.map(DocumentEntity::toDto) }
    }

    fun observeDocument(id: String): Flow<DocumentDto?> =
        documentDao.observeById(id).map { it?.toDto() }

    /** Fetch one page from the network into the cache. Throws [com.reverie.app.data.api.ReverieApiException]. */
    suspend fun refresh(folderId: String?, limit: Int, offset: Int): PageResult = withContext(io) {
        val page = documentsApi.list(limit = limit, offset = offset, folderId = folderId)
        val now = System.currentTimeMillis()
        documentDao.upsertAll(page.items.map { it.toEntity(now) })

        // If a single page covered the whole folder, drop rows the server no longer returns.
        if (folderId != null && offset == 0 && page.items.size >= page.total) {
            documentDao.deleteInFolderNotIn(folderId, page.items.map { it.id })
        }
        PageResult(total = page.total, loaded = offset + page.items.size)
    }

    /** Fetch + cache a single document detail (includes photo/LLM metadata). */
    suspend fun fetchDocument(id: String): DocumentDto = withContext(io) {
        val dto = documentsApi.get(id)
        documentDao.upsertAll(listOf(dto.toEntity(System.currentTimeMillis())))
        dto
    }

    suspend fun delete(ids: List<String>) = withContext(io) {
        documentsApi.deleteBatch(ids)
        documentDao.deleteByIds(ids)
    }

    suspend fun setPrivacy(ids: List<String>, isPrivate: Boolean) = withContext(io) {
        documentsApi.setPrivacy(ids, isPrivate)
        documentDao.setPrivacy(ids, isPrivate)
    }

    suspend fun rename(id: String, filename: String): DocumentDto = withContext(io) {
        val dto = documentsApi.rename(id, filename)
        documentDao.upsertAll(listOf(dto.toEntity(System.currentTimeMillis())))
        dto
    }

    suspend fun move(ids: List<String>, folderId: String) = withContext(io) {
        documentsApi.move(ids, folderId, conflict = null)
    }

    suspend fun touchAccessed(id: String) = withContext(io) {
        documentDao.touchLastAccessed(id, System.currentTimeMillis())
    }

    suspend fun retryOcr(id: String) = withContext(io) { documentsApi.retryOcr(id) }

    suspend fun reprocessLlm(id: String) = withContext(io) { documentsApi.reprocessLlm(id) }

    suspend fun ocrResult(id: String) = withContext(io) { documentsApi.ocrResult(id) }
}
