package com.reverie.app.ui.screens.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.UploadRepository
import com.reverie.app.data.upload.MediaAsset
import com.reverie.app.data.upload.MediaStorePhotoSource
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FolderOption(val id: String, val label: String, val emoji: String?)

data class ReviewState(
    val uris: List<Uri>,
    val fileNames: List<String>,
    val folderId: String?,
    val folderName: String?,
    val duplicates: List<String> = emptyList(),
    val sessionId: String? = null,
)

@HiltViewModel
class UploadViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val uploadRepository: UploadRepository,
    private val mediaSource: MediaStorePhotoSource,
    folderRepository: FolderRepository,
) : ViewModel() {

    suspend fun loadMedia(): List<MediaAsset> = mediaSource.queryRecent()

    private var lastUsedFolderId: String? = null

    val folders: StateFlow<List<FolderOption>> = folderRepository.observeTree()
        .map { flattenFolders(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _review = MutableStateFlow<ReviewState?>(null)
    val review: StateFlow<ReviewState?> = _review

    val activeCount: StateFlow<Int> = uploadRepository.observeActiveCount()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    fun observeItems(sessionId: String): Flow<List<UploadItemEntity>> = uploadRepository.observeItems(sessionId)

    fun beginReview(uris: List<Uri>, defaultFolderId: String?) {
        if (uris.isEmpty()) return
        val folderId = defaultFolderId ?: lastUsedFolderId ?: folders.value.firstOrNull()?.id
        _review.value = ReviewState(
            uris = uris,
            fileNames = uris.map { displayName(it) },
            folderId = folderId,
            folderName = folders.value.firstOrNull { it.id == folderId }?.label,
        )
    }

    fun setFolder(id: String) {
        _review.update { it?.copy(folderId = id, folderName = folders.value.firstOrNull { f -> f.id == id }?.label) }
    }

    /** Duplicate pre-check; if collisions, surface them so the UI can offer replace/keep-both. */
    fun requestUpload() {
        val state = _review.value ?: return
        val folderId = state.folderId ?: return
        viewModelScope.launch {
            val duplicates = uploadRepository.checkDuplicates(folderId, state.fileNames)
            if (duplicates.isNotEmpty()) {
                _review.update { it?.copy(duplicates = duplicates) }
            } else {
                start(folderId, conflictStrategy = null)
            }
        }
    }

    fun resolveDuplicates(conflictStrategy: String) {
        val folderId = _review.value?.folderId ?: return
        start(folderId, conflictStrategy)
    }

    private fun start(folderId: String, conflictStrategy: String?) {
        val state = _review.value ?: return
        lastUsedFolderId = folderId
        viewModelScope.launch {
            val sessionId = uploadRepository.startUpload(folderId, state.uris, conflictStrategy)
            _review.update { it?.copy(sessionId = sessionId, duplicates = emptyList()) }
        }
    }

    fun dismiss() {
        _review.value = null
    }

    fun clearCompleted() {
        viewModelScope.launch { uploadRepository.clearCompleted() }
    }

    private fun displayName(uri: Uri): String {
        var name = uri.lastPathSegment ?: "file"
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0 && !c.isNull(idx)) name = c.getString(idx)
                }
            }
        }
        return name
    }

    private fun flattenFolders(tree: List<FolderWithChildren>): List<FolderOption> {
        val out = mutableListOf<FolderOption>()
        tree.forEach { node ->
            if (node.type == FolderType.FOLDER) {
                out += FolderOption(node.id, node.name, node.emoji)
            }
            node.children.forEach { child ->
                if (child.type == FolderType.FOLDER) {
                    out += FolderOption(child.id, "${node.name} / ${child.name}", child.emoji)
                }
            }
        }
        return out
    }
}
