package com.reverie.app.data.repository

import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.entity.DocumentEntity
import com.reverie.app.data.local.toDto
import com.reverie.app.data.local.PrivateDataPurger
import com.reverie.app.data.local.PrivateDocumentStore
import com.reverie.app.data.local.toCacheableEntities
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** The signed URLs a video needs: the original, and its HLS master playlist when renditions exist. */
data class SignedUrls(val fileUrl: String, val hlsUrl: String?)

/** One page of a refresh: the server total and how many rows we've loaded so far. */
data class PageResult(val total: Int, val loaded: Int) {
    val hasMore: Boolean get() = loaded < total
}

/**
 * Stale-while-revalidate access to documents. Room is the display source of truth; the
 * network refreshes it. Signed file/thumbnail URLs are never persisted (see [toCacheableEntities]).
 *
 * Documents in private folders are the exception to "Room is the source of truth": they are kept
 * only in [privateStore] (process memory) and merged into the folder/document flows, so no
 * private metadata reaches disk.
 */
@Singleton
class DocumentRepository @Inject constructor(
    private val documentDao: DocumentDao,
    private val documentsApi: DocumentsApi,
    private val privateStore: PrivateDocumentStore,
    private val purger: PrivateDataPurger,
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

    // The HLS master URL signed alongside each cached file URL (same lifetime, same harvesting).
    // Absent when the document has no renditions (yet).
    private val hlsUrls = java.util.concurrent.ConcurrentHashMap<String, String>()

    // In-flight fileUrl fetches by id: the grid's tap-time prefetch and the viewer's compose-time
    // fetch race for the same URL — the loser awaits the winner's round-trip instead of issuing a
    // duplicate GET /documents/:id (which used to serialize the two and delay prepare() by a full
    // round-trip). Flights run in their own scope so a caller's cancellation (e.g. the viewer
    // leaving composition) doesn't kill the shared fetch.
    private val fileUrlFlights = java.util.concurrent.ConcurrentHashMap<String, Deferred<String?>>()
    private val flightScope = CoroutineScope(SupervisorJob() + io)
    /**
     * Documents for the grid. `folderId == null` is the all-documents view, which by design never
     * contains private documents; a folder view also carries that folder's in-memory private ones.
     */
    fun observeDocuments(folderId: String?): Flow<List<DocumentDto>> {
        // Map entities→DTOs (allocations + JSON parsing) off the main thread; without this the grid's
        // combine/stateIn on viewModelScope (Main) re-maps the whole cached list on every Room write.
        if (folderId == null) {
            return documentDao.observeAll().map { rows -> rows.map(DocumentEntity::toDto) }.flowOn(io)
        }
        val cached = documentDao.observeByFolder(folderId).map { rows -> rows.map(DocumentEntity::toDto) }
        return combine(cached, privateStore.observeFolder(folderId)) { rows, private ->
            if (private.isEmpty()) rows else (rows + private).sortedByDescending { it.created_at }
        }.flowOn(io)
    }

    fun observeDocument(id: String): Flow<DocumentDto?> {
        // distinctUntilChanged (entity-level) drops the re-map on every unrelated Room write to this
        // row (touchAccessed, the open-time fetch upsert); flowOn(io) keeps toDto's JSON parse off
        // the main thread, mirroring observeDocuments.
        val cached = documentDao.observeById(id).distinctUntilChanged().map { it?.toDto() }
        return combine(cached, privateStore.observe(id)) { row, private -> private ?: row }.flowOn(io)
    }

    /**
     * Route fetched documents to their store: public ones to Room, private ones to memory (and
     * purge any disk copy cached before the document became private).
     */
    private suspend fun absorb(items: List<DocumentDto>) {
        val now = System.currentTimeMillis()
        documentDao.upsertAll(items.toCacheableEntities(now))
        val (private, public) = items.partition { it.is_private }
        privateStore.putAll(private)
        // A document that left its private folder (now public) must stop being served from memory.
        privateStore.remove(public.map { it.id })
        purger.purgeCachedCopies(private.map { it.id })
        // Harvest the per-row signed URLs (see fileUrls above) before Room strips them.
        items.forEach { dto ->
            val fileUrl = dto.file_url ?: return@forEach
            fileUrls[dto.id] = fileUrl
            val hlsUrl = dto.hls_url
            if (hlsUrl != null) hlsUrls[dto.id] = hlsUrl else hlsUrls.remove(dto.id)
        }
    }

    /** Fetch one page from the network into the cache. Throws [com.reverie.app.data.api.ReverieApiException]. */
    suspend fun refresh(folderId: String?, limit: Int, offset: Int): PageResult = withContext(io) {
        val page = documentsApi.list(limit = limit, offset = offset, folderId = folderId)
        absorb(page.items)

        // If a single page covered the whole folder, drop rows the server no longer returns.
        if (folderId != null && offset == 0 && page.items.size >= page.total) {
            val keep = page.items.map { it.id }
            documentDao.deleteInFolderNotIn(folderId, keep)
            privateStore.removeInFolderNotIn(folderId, keep.toSet())
        }
        PageResult(total = page.total, loaded = offset + page.items.size)
    }

    /** Fetch + cache a single document detail (includes photo/LLM metadata). */
    suspend fun fetchDocument(id: String): DocumentDto = withContext(io) {
        val dto = documentsApi.get(id)
        // Also refreshes the in-memory signed URL — this is where a rotated signature lands.
        absorb(listOf(dto))
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

    /** [fileUrl] and the HLS master URL signed with it, as one pair so a viewer never starts on the original and then switches. */
    suspend fun signedUrls(id: String): SignedUrls? {
        val fileUrl = fileUrl(id) ?: return null
        return SignedUrls(fileUrl, hlsUrls[id])
    }

    /** Fetch the document again for fresh signatures: the cached ones expire while a video plays or sits paused. */
    suspend fun refreshSignedUrls(id: String): SignedUrls? {
        val dto = runCatching { fetchDocument(id) }.getOrNull() ?: return null
        val fileUrl = dto.file_url ?: return null
        return SignedUrls(fileUrl, dto.hls_url)
    }

    suspend fun delete(ids: List<String>) = withContext(io) {
        documentsApi.deleteBatch(ids)
        documentDao.deleteByIds(ids)
        privateStore.remove(ids)
        ids.forEach {
            fileUrls.remove(it)
            hlsUrls.remove(it)
        }
    }

    suspend fun rename(id: String, filename: String): DocumentDto = withContext(io) {
        val dto = documentsApi.rename(id, filename)
        absorb(listOf(dto))
        dto
    }

    suspend fun move(ids: List<String>, folderId: String) = withContext(io) {
        documentsApi.move(ids, folderId, conflict = null)
        // The destination may be private (or the source was): drop every local copy and let the
        // next folder refresh re-route each document to the right store.
        purger.forgetMoved(ids)
    }

    suspend fun touchAccessed(id: String) = withContext(io) {
        documentDao.touchLastAccessed(id, System.currentTimeMillis())
    }

    suspend fun retryOcr(id: String) = withContext(io) { documentsApi.retryOcr(id) }

    suspend fun reprocessLlm(id: String) = withContext(io) { documentsApi.reprocessLlm(id) }

    suspend fun ocrResult(id: String) = withContext(io) { documentsApi.ocrResult(id) }
}
