package com.reverie.app.ui.screens.viewer

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentOcrResult
import com.reverie.app.data.api.model.JobEventType
import com.reverie.app.data.api.model.UserRole
import com.reverie.app.data.local.FileCacheManager
import com.reverie.app.data.realtime.RealtimeManager
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.SignedUrls
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.data.settings.VideoBackground
import com.reverie.app.domain.model.AuthState
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.favourites.FavouriteDeps
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

/**
 * Backs the swipe-between-documents viewer. Instead of being bound to one id, it pages over an
 * ordered [ids] sequence (handed off via [DocumentSequenceHolder], falling back to just the route
 * id after process death) and exposes id-parameterized operations that each page/the toolbar call
 * for whichever document they show.
 */
@HiltViewModel
class DocumentViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val documentRepository: DocumentRepository,
    vaultRepository: VaultRepository,
    private val fileCacheManager: FileCacheManager,
    private val realtimeManager: RealtimeManager,
    private val serverUrlProvider: ServerUrlProvider,
    private val sequenceHolder: DocumentSequenceHolder,
    authRepository: com.reverie.app.data.repository.AuthRepository,
    settingsRepository: SettingsRepository,
    favouriteDeps: FavouriteDeps,
) : ViewModel() {

    /** The star in the toolbar, and the password prompt it may need. */
    val favourites = FavouriteController(favouriteDeps, viewModelScope)

    private val initialId: String = checkNotNull(savedStateHandle["id"])
    private val fallback = listOf(initialId)
    private val sequence = sequenceHolder.current

    /** True when there is no live sequence (process death / deep link): a single-document pager. */
    val isFallback: Boolean get() = sequence == null

    /**
     * Ordered ids the pager swipes through — live so it grows as the origin paginates, and shrinks
     * to empty (→ the screen pops) when the origin folder empties. Only the initial value falls back
     * to the route id; the live stream is passed through untouched so a real "all deleted" reaches us.
     */
    val ids: StateFlow<List<String>> = (sequence?.ids ?: flowOf(fallback))
        .distinctUntilChanged()
        .stateIn(
            viewModelScope,
            SharingStarted.Eagerly,
            sequence?.initialIds?.ifEmpty { fallback } ?: fallback,
        )

    val isAdmin: StateFlow<Boolean> = authRepository.authState
        .map { (it as? AuthState.Authenticated)?.user?.role == UserRole.ADMIN }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** What fills the area around a letterboxed video, per the user's setting. */
    val videoBackground: StateFlow<VideoBackground> = settingsRepository.settings
        .map { it.videoBackground }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), VideoBackground.BLACK)

    // Documents the server refused with FOLDER_LOCKED (document id -> the lock that guards it), so
    // the page can offer an unlock instead of an endless spinner.
    private val _lockedDocuments = MutableStateFlow<Map<String, String>>(emptyMap())
    val lockedDocuments: StateFlow<Map<String, String>> = _lockedDocuments.asStateFlow()

    /** Password prompt for a locked folder; a successful unlock re-fetches the refused documents. */
    val unlocker = FolderUnlocker(vaultRepository, viewModelScope) { folderId -> retryLocked(folderId) }

    private var currentSub: AutoCloseable? = null
    private var currentId: String? = null

    init {
        favourites.load()
        // Refetch the visible document when its processing settles (thumbnail/OCR/LLM), so the
        // toolbar/insights update live — mirrors the old single-document behavior for the current page.
        viewModelScope.launch {
            realtimeManager.events
                .filter { it.document_id != null && it.document_id == currentId }
                .collect { event ->
                    if (event.type == JobEventType.COMPLETE || event.type == JobEventType.FAILED) {
                        refresh(event.document_id!!)
                    }
                }
        }
    }

    fun observeDocument(id: String): Flow<DocumentDto?> = documentRepository.observeDocument(id)

    /** Signed URL for [id] — served from the repository's app-scoped cache (warmed on tap) or fetched. */
    suspend fun fileUrl(id: String): String? = documentRepository.fileUrl(id)?.let(::absolute)

    /** The original's and the HLS renditions' signed URLs for [id], made absolute; both from one fetch. */
    suspend fun signedUrls(id: String): SignedUrls? = documentRepository.signedUrls(id)?.let(::absoluteUrls)

    /** Fresh URLs after a 403/410 on the stream: a signature expired while the video played or sat paused. */
    suspend fun refreshSignedUrls(id: String): SignedUrls? = documentRepository.refreshSignedUrls(id)?.let(::absoluteUrls)

    /** The pager settled on [id]: move the realtime subscription, mark accessed, sync the origin grid. */
    fun onPageSettled(id: String) {
        if (id == currentId) return
        currentId = id
        // The star waits for the list; try again if the first fetch failed.
        if (!favourites.state.value.isLoaded) favourites.load()
        currentSub?.close()
        viewModelScope.launch { currentSub = realtimeManager.subscribeDocument(id) }
        viewModelScope.launch { documentRepository.touchAccessed(id) }
        sequenceHolder.setFocused(id)
        // Pull the detail record into Room so observers get llm_summary/llm_metadata (insights) and
        // photo_metadata (location map) — the list endpoint serializes all three as null. This used to
        // happen as a side effect of fileUrl()'s fetch, but list-page URL warming now lets fileUrl()
        // return without a /documents/:id round-trip, so the detail must be pulled explicitly on open.
        refresh(id)
    }

    /** Near the tail → ask the origin for its next page (guarded/ignored when there is no more). */
    fun requestMoreIfNeeded(index: Int) {
        val seq = sequence ?: return
        if (index >= ids.value.size - 2) seq.loadMore()
    }

    suspend fun originalFile(id: String, onProgress: ((Float) -> Unit)? = null): File =
        fileCacheManager.getOrFetch(id, onProgress)

    suspend fun ocrResult(id: String): DocumentOcrResult = documentRepository.ocrResult(id)

    fun retryOcr(id: String) = viewModelScope.launch {
        runCatching { documentRepository.retryOcr(id) }
        refresh(id)
    }

    fun reprocessLlm(id: String) = viewModelScope.launch {
        runCatching { documentRepository.reprocessLlm(id) }
        refresh(id)
    }

    fun rename(id: String, filename: String) = viewModelScope.launch {
        runCatching { documentRepository.rename(id, filename) }
    }

    fun delete(id: String, onDeleted: () -> Unit) = viewModelScope.launch {
        runCatching { documentRepository.delete(listOf(id)) }.onSuccess { onDeleted() }
    }

    override fun onCleared() {
        currentSub?.close()
        // Leaving the viewer: the transient on-disk copies of private originals go with it.
        fileCacheManager.clearPrivate()
    }

    /** Ask for the password of the lock guarding [id], when the server has said it is locked. */
    fun requestUnlock(id: String) {
        val folderId = _lockedDocuments.value[id] ?: return
        unlocker.request(folderId)
    }

    private fun retryLocked(folderId: String) {
        val ids = _lockedDocuments.value.filterValues { it == folderId }.keys
        _lockedDocuments.update { it - ids }
        ids.forEach(::refresh)
    }

    private fun onFetchFailed(id: String, throwable: Throwable) {
        val folderId = (throwable as? ReverieApiException)?.lockedFolderId() ?: return
        _lockedDocuments.update { it + (id to folderId) }
        if (id == currentId) unlocker.request(folderId)
    }

    /** Re-pull the record into Room so observers (toolbar/insights) refresh; this also refreshes the
     * repository's cached signed URL (a rotated signature lands on fetch). */
    private fun refresh(id: String) {
        viewModelScope.launch {
            runCatching { documentRepository.fetchDocument(id) }.onFailure { onFetchFailed(id, it) }
        }
    }

    private fun absoluteUrls(urls: SignedUrls): SignedUrls =
        SignedUrls(absolute(urls.fileUrl), urls.hlsUrl?.let(::absolute))

    private fun absolute(url: String): String =
        if (url.startsWith("http")) url else serverUrlProvider.current().removeSuffix("/") + url
}
