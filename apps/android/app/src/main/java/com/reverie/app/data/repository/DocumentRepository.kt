package com.reverie.app.data.repository

import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.Paginated
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
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** Most ids one delete statement takes (SQLite's variable limit is 999 on older Android). */
private const val DELETE_CHUNK = 500

/** The signed URLs a video needs: the original, and its HLS master playlist when renditions exist. */
data class SignedUrls(val fileUrl: String, val hlsUrl: String?)

/**
 * One page of a refresh: the server total, how many rows we've loaded so far, the page's last row in
 * the server's order (null for an empty page) so a caller can tell how far down it has read, and the
 * ids of the page's rows.
 */
data class PageResult(val total: Int, val loaded: Int, val last: DocumentDto? = null, val ids: List<String> = emptyList()) {
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
) : ProcessingDocuments {
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

    // The last summary read for each scope (null is the whole library). Memory only: figures that are
    // not from the server right now are not shown after a restart, and cached rows are never counted instead.
    private val summaries = MutableStateFlow<Map<String?, DocumentSummaryDto>>(emptyMap())

    private val contentChangesFlow = MutableSharedFlow<Unit>(extraBufferCapacity = 8)

    /**
     * Fires when documents were removed or added by this device, so every Browse screen that is still
     * on the back stack re-reads its totals, not only the screen the change was made on.
     */
    val contentChanges: SharedFlow<Unit> = contentChangesFlow.asSharedFlow()

    fun announceContentChanged() {
        contentChangesFlow.tryEmit(Unit)
    }

    private val deletedIdsFlow = MutableStateFlow<Set<String>>(emptySet())

    /** Documents deleted from this device in this process, for lists that were snapshotted before. */
    val deletedIds: StateFlow<Set<String>> = deletedIdsFlow.asStateFlow()

    /** The last summary [fetchSummary] read for [folderId] in this process; null before the first one. */
    fun summary(folderId: String?): Flow<DocumentSummaryDto?> = summaries.map { it[folderId] }.distinctUntilChanged()

    /** Reads the summary of [folderId] (the whole library when null) and keeps it for [summary]. Throws [com.reverie.app.data.api.ReverieApiException]. */
    suspend fun fetchSummary(folderId: String?): DocumentSummaryDto = withContext(io) {
        documentsApi.summary(folderId).also { fresh -> summaries.update { it + (folderId to fresh) } }
    }

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

    /** Ids of the documents held here whose thumbnail job has not finished. */
    fun observeAwaitingThumbnail(): Flow<Set<String>> =
        combine(documentDao.observeIdsAwaitingThumbnail(), privateStore.documents) { cached, private ->
            cached.toSet() + private.values.filterNot { it.thumbnail_status.isTerminal }.map { it.id }
        }.distinctUntilChanged().flowOn(io)

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
        documentDao.upsertAll(withKnownTakenAt(items.toCacheableEntities(now)))
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

    /**
     * A response that carries no date taken (a rename or a search hit) must not wipe the one the
     * Photos and Videos tabs order by: rows without one keep the cached value.
     */
    private suspend fun withKnownTakenAt(entities: List<DocumentEntity>): List<DocumentEntity> {
        val missing = entities.filter { it.takenAt == null }.map { it.id }
        if (missing.isEmpty()) return entities
        val known = documentDao.takenAtOf(missing).associate { it.id to it.takenAt }
        if (known.isEmpty()) return entities
        return entities.map { if (it.takenAt == null) it.copy(takenAt = known[it.id]) else it }
    }

    /**
     * Fetch one page of [kind] (every kind when null) from the network into the cache. Throws
     * [com.reverie.app.data.api.ReverieApiException].
     */
    suspend fun refresh(folderId: String?, limit: Int, offset: Int, kind: DocumentKind? = null): PageResult = withContext(io) {
        val page = documentsApi.list(limit = limit, offset = offset, folderId = folderId, kind = kind)
        absorb(page.items)

        // If a single page covered the whole folder, drop rows the server no longer returns: only
        // those of the fetched kind, since the page says nothing about the other kinds.
        if (folderId != null && offset == 0 && page.items.size >= page.total) dropStale(folderId, kind, page.items.map { it.id }.toSet())
        PageResult(total = page.total, loaded = offset + page.items.size, last = page.items.lastOrNull(), ids = page.items.map { it.id })
    }

    /**
     * The library-wide counterpart of [dropStale]: once every page of [kind] (every kind when null) has
     * been read, drop the cached rows of that kind that the server did not return ([keep]). Rows of the
     * other kinds are untouched, since a listing of one kind says nothing about them. Private documents
     * are never in the library-wide listing nor in Room, so the in-memory store has nothing to drop.
     */
    suspend fun dropStaleInLibrary(kind: DocumentKind?, keep: Set<String>) = withContext(io) {
        val stale = documentDao.allMimeTypes()
            .filter { it.id !in keep && (kind == null || DocumentKind.of(it.mimeType) == kind) }
            .map { it.id }
        // Chunked: SQLite caps the variables of one statement, and a library can hold more rows than that.
        stale.chunked(DELETE_CHUNK).forEach { documentDao.deleteByIds(it) }
    }

    private suspend fun dropStale(folderId: String, kind: DocumentKind?, keep: Set<String>) {
        if (kind == null) {
            documentDao.deleteInFolderNotIn(folderId, keep.toList())
            privateStore.removeInFolderNotIn(folderId, keep)
            return
        }
        val stale = documentDao.mimeTypesInFolder(folderId).filter { it.id !in keep && DocumentKind.of(it.mimeType) == kind }.map { it.id }
        if (stale.isNotEmpty()) documentDao.deleteByIds(stale)
        privateStore.removeInFolderNotIn(folderId, keep, kind)
    }

    /**
     * One page of the library's still-processing documents (newest first), cached like any list
     * page so the grid and the processing sheet see their current statuses. `total` is the number
     * of processing documents in the whole library.
     */
    override suspend fun fetchProcessing(limit: Int, offset: Int): Paginated<DocumentDto> = withContext(io) {
        val page = documentsApi.list(limit = limit, offset = offset, processing = true)
        absorb(page.items)
        page
    }

    /** Fetch + cache a single document detail (includes photo/LLM metadata). */
    override suspend fun fetchDocument(id: String): DocumentDto = withContext(io) {
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
        deletedIdsFlow.update { it + ids }
        announceContentChanged()
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
