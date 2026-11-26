package com.reverie.app.ui.screens.upload

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.UploadRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.data.upload.HashProgress
import com.reverie.app.data.upload.MediaAsset
import com.reverie.app.data.upload.MediaStorePhotoSource
import com.reverie.app.domain.FolderTree
import com.reverie.app.domain.upload.NameStrategy
import com.reverie.app.domain.upload.UploadProgress
import com.reverie.app.domain.upload.toFindings
import com.reverie.app.ui.components.LIBRARY_NAME
import com.reverie.app.ui.screens.destination.Destination
import com.reverie.app.ui.screens.destination.DestinationBrowser
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class UploadViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val uploadRepository: UploadRepository,
    private val mediaSource: MediaStorePhotoSource,
    folderRepository: FolderRepository,
    vault: VaultRepository,
) : ViewModel() {

    suspend fun loadMedia(): List<MediaAsset> = mediaSource.queryRecent()

    /** Picks where the upload goes. */
    val destinations = DestinationBrowser(folderRepository, vault, viewModelScope)

    private val _review = MutableStateFlow<ReviewState?>(null)

    /** The upload being put together, with the folder's name as the tree has it; null: no upload screen. */
    val review: StateFlow<ReviewState?> = combine(_review, folderRepository.observeTree().onStart { emit(emptyList()) }) { review, tree ->
        val name = review?.folderId?.let { FolderTree(tree).find(it)?.name }
        if (name == null) review else review?.copy(folderName = name)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val progress: StateFlow<UploadProgress?> = uploadRepository.observeProgress()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private var checkJob: Job? = null

    /** Opens the upload screen for [uris], headed for [folderId] (null: the Library). */
    fun beginReview(uris: List<Uri>, folderId: String?) {
        if (uris.isEmpty() || _review.value?.isStarting == true) return
        checkJob?.cancel()
        _review.value = ReviewState(
            files = uris.map { context.toPickedFile(it) },
            folderId = folderId,
            folderName = if (folderId == null) LIBRARY_NAME else "This folder",
        )
    }

    fun pickLocation() {
        val state = review.value ?: return
        if (state.isBusy) return
        destinations.show(startAt = state.folderId)
    }

    /** What the check found is about the old place, so it goes. */
    fun setLocation(destination: Destination) {
        _review.update {
            it?.copy(folderId = destination.folderId, folderName = destination.name, findings = emptyList(), uploadAnyway = emptySet(), error = null)
        }
    }

    /** The upload screen's button: checks the files first, or goes ahead with the answers to that check. */
    fun upload() {
        val state = review.value ?: return
        if (state.isBusy) return
        if (state.findings.isEmpty()) return check(state)
        val kept = state.kept
        if (kept.isEmpty()) return dismiss()
        start(state.folderId, kept, state.nameStrategy.wire.takeIf { state.asksStrategy })
    }

    /**
     * Hashes the picked files from their URIs, asks the server which of them are already in the library,
     * and either uploads straight away or surfaces [ReviewState.findings] for the person to decide.
     * Nothing is staged before that. If the check itself fails the upload carries on without it.
     */
    private fun check(state: ReviewState) {
        _review.update { it?.copy(checking = HashProgress(0, state.files.size, 0, 0), error = null) }
        checkJob = viewModelScope.launch {
            val hashes = uploadRepository.hashContents(state.files.map { it.uri }) { progress ->
                _review.update { it?.copy(checking = progress) }
            }
            val files = state.files.mapIndexed { index, file -> CheckContentFile(file.name, hashes[index]) }
            val results = uploadRepository.checkContent(DocumentScope.of(state.folderId), files)
            val findings = results?.let { toFindings(state.files.map { file -> file.name }, it) }.orEmpty()
            if (findings.isEmpty()) return@launch start(state.folderId, state.files, conflictStrategy = null)
            _review.update {
                it?.copy(checking = null, findings = findings, uploadAnyway = emptySet(), unhashed = hashes.count { hash -> hash == null })
            }
        }
    }

    fun setUploadAnyway(index: Int, upload: Boolean) {
        _review.update { state -> state?.copy(uploadAnyway = if (upload) state.uploadAnyway + index else state.uploadAnyway - index) }
    }

    fun setNameStrategy(strategy: NameStrategy) {
        _review.update { it?.copy(nameStrategy = strategy) }
    }

    private fun start(folderId: String?, files: List<PickedFile>, conflictStrategy: String?) {
        _review.update { it?.copy(checking = null, isStarting = true, error = null) }
        viewModelScope.launch {
            try {
                uploadRepository.startUpload(folderId, files.map { it.uri }, conflictStrategy)
                _review.value = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _review.update { it?.copy(isStarting = false, error = "Couldn't start the upload.") }
            }
        }
    }

    /**
     * Closes the upload screen with nothing uploaded. Ignored while the files are being copied aside:
     * closing the share target then would end it before the upload exists.
     */
    fun dismiss() {
        if (_review.value?.isStarting == true) return
        checkJob?.cancel()
        destinations.close()
        _review.value = null
    }

    fun clearFinished() {
        viewModelScope.launch { uploadRepository.clearFinished() }
    }
}
