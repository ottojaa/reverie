package com.reverie.app.data.repository

import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.entity.DocumentEntity
import com.reverie.app.data.local.toDto
import com.reverie.app.data.local.toEntity
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
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
    // Signed file URLs are never persisted (Room strips them), so opening a document would normally
    // pay a fresh /documents/:id round-trip. Cache the last-seen URL in memory — app-scoped, so a tap
    // in the grid can warm it before the viewer's ViewModel even exists — harvested from EVERY fetch
    // (list pages included: the server signs a file_url per row anyway), and refreshed on every
    // re-fetch (which is when a rotated signature arrives). With the grid freshly listed, a video
    // open reaches ExoPlayer.prepare() with zero extra round-trips. Concurrent-safe: read/written
    // from IO coroutines.
    private val fileUrls = java.util.concurrent.ConcurrentHashMap<String, String>()

    // In-flight fileUrl fetches by id: the grid's tap-time prefetch and the viewer's compose-time
    // fetch race for the same URL — the loser awaits the winner's round-trip instead of issuing a
    // duplicate GET /documents/:id (which used to serialize the two and delay prepare() by a full
    // round-trip). Flights run in their own scope so a caller's cancellation (e.g. the viewer
    // leaving composition) doesn't kill the shared fetch.
    private val fileUrlFlights = java.util.concurrent.ConcurrentHashMap<String, Deferred<String?>>()
    private val flightScope = CoroutineScope(SupervisorJob() + io)
    /** Cached documents for the grid. `folderId == null` is the all-documents view. */
    fun observeDocuments(folderId: String?): Flow<List<DocumentDto>> {
        val source = if (folderId == null) documentDao.observeAll() else documentDao.observeByFolder(folderId)
        // Map entities→DTOs (allocations + JSON parsing) off the main thread; without this the grid's
        // combine/stateIn on viewModelScope (Main) re-maps the whole cached list on every Room write.
        return source.map { rows -> rows.map(DocumentEntity::toDto) }.flowOn(io)
    }

    fun observeDocument(id: String): Flow<DocumentDto?> =
        // distinctUntilChanged (entity-level) drops the re-map on every unrelated Room write to this
        // row (touchAccessed, the open-time fetch upsert); flowOn(io) keeps toDto's JSON parse off
        // the main thread, mirroring observeDocuments.
        documentDao.observeById(id).distinctUntilChanged().map { it?.toDto() }.flowOn(io)

    /** Fetch one page from the network into the cache. Throws [com.reverie.app.data.api.ReverieApiException]. */
    suspend fun refresh(folderId: String?, limit: Int, offset: Int): PageResult = withContext(io) {
        val page = documentsApi.list(limit = limit, offset = offset, folderId = folderId)
        val now = System.currentTimeMillis()
        documentDao.upsertAll(page.items.map { it.toEntity(now) })
        // Harvest the per-row signed URLs (see fileUrls above) before Room strips them.
        page.items.forEach { dto -> dto.file_url?.let { fileUrls[dto.id] = it } }

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
        // Refresh the in-memory signed URL — this is where a rotated signature lands.
        dto.file_url?.let { fileUrls[id] = it }
        dto
    }

    /**
     * The signed file URL for [id]: the cached one if we've fetched it this session, else a fresh
     * (single-flight) fetch. Returned raw (server-relative or absolute) — callers resolve it
     * against the server base.
     */
    suspend fun fileUrl(id: String): String? {
        fileUrls[id]?.let { return it }
        val flight = fileUrlFlights.computeIfAbsent(id) {
            flightScope.async { runCatching { fetchDocument(id) }.getOrNull()?.file_url }
        }
        return try {
            flight.await()
        } finally {
            fileUrlFlights.remove(id, flight)
        }
    }

    suspend fun delete(ids: List<String>) = withContext(io) {
        documentsApi.deleteBatch(ids)
        documentDao.deleteByIds(ids)
        ids.forEach { fileUrls.remove(it) }
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
