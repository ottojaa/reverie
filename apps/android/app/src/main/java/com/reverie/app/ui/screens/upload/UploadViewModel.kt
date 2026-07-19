package com.reverie.app.ui.screens.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.UploadRepository
import com.reverie.app.data.upload.MediaAsset
import com.reverie.app.data.upload.MediaStorePhotoSource
import com.reverie.app.ui.screens.collections.FolderFormData
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FolderOption(val id: String, val label: String, val emoji: String?)

/**
 * A collection (or the root pseudo-group) with its uploadable child folders, for the hierarchical
 * folder picker. [collectionId] is the parent id used when creating a folder here — null for the
 * root pseudo-section, whose new folders have no parent.
 */
data class FolderPickerSection(
    val id: String,
    val name: String,
    val emoji: String?,
    val collectionId: String?,
    val folders: List<FolderOption>,
)

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
    private val folderRepository: FolderRepository,
) : ViewModel() {

    suspend fun loadMedia(): List<MediaAsset> = mediaSource.queryRecent()

    private var lastUsedFolderId: String? = null

    /** Collections with their child folders, for the hierarchical picker. */
    val pickerSections: StateFlow<List<FolderPickerSection>> = folderRepository.observeTree()
        .map { toPickerSections(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** id → folder label, so the review's folder name resolves even when the tree loads late. */
    private val folderNames: StateFlow<Map<String, String>> = folderRepository.observeTree()
        .map { tree -> flattenFolders(tree).associate { it.id to it.label } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    private val _review = MutableStateFlow<ReviewState?>(null)

    /**
     * The review with its [ReviewState.folderName] resolved reactively from the folder tree. The old
     * code snapshotted the name from a StateFlow nothing collected, so it was always null — the
     * preselected folder showed "Choose a folder" and picking one never updated the label.
     */
    val review: StateFlow<ReviewState?> = combine(_review, folderNames) { review, names ->
        review?.let { r -> r.folderId?.let { id -> r.copy(folderName = names[id] ?: r.folderName) } ?: r }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val activeCount: StateFlow<Int> = uploadRepository.observeActiveCount()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    fun observeItems(sessionId: String): Flow<List<UploadItemEntity>> = uploadRepository.observeItems(sessionId)

    fun beginReview(uris: List<Uri>, defaultFolderId: String?) {
        if (uris.isEmpty()) return
        // Preselect the folder we're uploading from (or the last used one). The name is resolved
        // reactively by [review] once the tree is available.
        _review.value = ReviewState(
            uris = uris,
            fileNames = uris.map { displayName(it) },
            folderId = defaultFolderId ?: lastUsedFolderId,
            folderName = null,
        )
    }

    fun setFolder(id: String) {
        _review.update { it?.copy(folderId = id, folderName = null) }
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

    /** Create a folder inline from the picker and select it. [parentId] null → a root-level folder. */
    fun createFolder(parentId: String?, form: FolderFormData) {
        viewModelScope.launch {
            runCatching {
                val created = folderRepository.create(
                    CreateFolderRequest(
                        name = form.name,
                        parent_id = parentId,
                        description = form.description,
                        emoji = form.emoji,
                        type = FolderType.FOLDER,
                    ),
                )
                if (form.isPrivate) folderRepository.update(created.id, UpdateFolderRequest(is_private = true))
                created
            }.onSuccess { created ->
                lastUsedFolderId = created.id
                _review.update { it?.copy(folderId = created.id, folderName = created.name) }
            }
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
                    out += FolderOption(child.id, child.name, child.emoji)
                }
            }
        }
        return out
    }

    private fun toPickerSections(tree: List<FolderWithChildren>): List<FolderPickerSection> {
        val sections = mutableListOf<FolderPickerSection>()
        val rootFolders = mutableListOf<FolderOption>()
        tree.forEach { node ->
            when (node.type) {
                FolderType.COLLECTION -> sections += FolderPickerSection(
                    id = node.id,
                    name = node.name,
                    emoji = node.emoji,
                    collectionId = node.id,
                    folders = node.children
                        .filter { it.type == FolderType.FOLDER }
                        .map { FolderOption(it.id, it.name, it.emoji) },
                )
                FolderType.FOLDER -> rootFolders += FolderOption(node.id, node.name, node.emoji)
            }
        }
        if (rootFolders.isNotEmpty()) {
            sections += FolderPickerSection(id = "root", name = "Folders", emoji = null, collectionId = null, folders = rootFolders)
        }
        return sections
    }
}
