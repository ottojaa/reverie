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
import com.reverie.app.domain.model.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

data class DocumentUiState(
    val document: DocumentDto? = null,
    val fileUrl: String? = null,
    val isLoading: Boolean = true,
    val error: String? = null,
    val isAdmin: Boolean = false,
)

private data class LoadState(val isLoading: Boolean = true, val error: String? = null)

@HiltViewModel
class DocumentViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val documentRepository: DocumentRepository,
    private val fileCacheManager: FileCacheManager,
    private val realtimeManager: RealtimeManager,
    private val serverUrlProvider: ServerUrlProvider,
    authRepository: com.reverie.app.data.repository.AuthRepository,
) : ViewModel() {

    private val documentId: String = checkNotNull(savedStateHandle["id"])

    /** The freshly-fetched document (carries the signed file_url the cache strips). */
    private val fresh = MutableStateFlow<DocumentDto?>(null)
    private val loadState = MutableStateFlow(LoadState())

    private var subscription: AutoCloseable? = null

    val uiState: StateFlow<DocumentUiState> = combine(
        documentRepository.observeDocument(documentId),
        fresh,
        authRepository.authState,
        loadState,
    ) { cached, freshDoc, auth, load ->
        DocumentUiState(
            document = cached ?: freshDoc,
            fileUrl = freshDoc?.file_url?.let(::absolute),
            isLoading = load.isLoading && cached == null && freshDoc == null,
            error = load.error,
            isAdmin = (auth as? AuthState.Authenticated)?.user?.role == UserRole.ADMIN,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DocumentUiState())

    init {
        load()
        viewModelScope.launch { documentRepository.touchAccessed(documentId) }
        viewModelScope.launch { subscription = realtimeManager.subscribeDocument(documentId) }
        viewModelScope.launch {
            realtimeManager.events
                .filter { it.document_id == documentId }
                .collect { event ->
                    if (event.type == JobEventType.COMPLETE || event.type == JobEventType.FAILED) load()
                }
        }
    }

    fun load() {
        viewModelScope.launch {
            loadState.update { it.copy(isLoading = true, error = null) }
            runCatching { documentRepository.fetchDocument(documentId) }
                .onSuccess { fresh.value = it; loadState.update { s -> s.copy(isLoading = false, error = null) } }
                .onFailure { t -> loadState.update { it.copy(isLoading = false, error = messageFor(t)) } }
        }
    }

    suspend fun originalFile(): File = fileCacheManager.getOrFetch(documentId)

    suspend fun ocrResult(): DocumentOcrResult = documentRepository.ocrResult(documentId)

    fun retryOcr() = viewModelScope.launch {
        runCatching { documentRepository.retryOcr(documentId) }
        load()
    }

    fun reprocessLlm() = viewModelScope.launch {
        runCatching { documentRepository.reprocessLlm(documentId) }
        load()
    }

    fun setPrivate(isPrivate: Boolean) = viewModelScope.launch {
        runCatching { documentRepository.setPrivacy(listOf(documentId), isPrivate) }
        load()
    }

    fun rename(filename: String) = viewModelScope.launch {
        runCatching { documentRepository.rename(documentId, filename) }
        load()
    }

    fun delete(onDeleted: () -> Unit) = viewModelScope.launch {
        runCatching { documentRepository.delete(listOf(documentId)) }.onSuccess { onDeleted() }
    }

    override fun onCleared() {
        subscription?.close()
    }

    private fun absolute(url: String): String =
        if (url.startsWith("http")) url else serverUrlProvider.current().removeSuffix("/") + url

    private fun messageFor(throwable: Throwable): String =
        (throwable as? ReverieApiException)?.userMessage() ?: "Couldn't load this document."
}
