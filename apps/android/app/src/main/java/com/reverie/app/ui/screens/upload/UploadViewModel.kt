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
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.upload.HashProgress
import com.reverie.app.data.upload.MediaAsset
import com.reverie.app.data.upload.MediaStorePhotoSource
import com.reverie.app.domain.upload.ContentFinding
import com.reverie.app.domain.upload.NameStrategy
import com.reverie.app.domain.upload.keptItems
import com.reverie.app.domain.upload.needsNameChoice
import com.reverie.app.domain.upload.toFindings
import com.reverie.app.ui.screens.collections.FolderFormData
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
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
    val sessionId: String? = null,
    /** Hashing the files / asking the server about them; null when not checking. */
    val checking: HashProgress? = null,
    /** Files whose content or name is already in the library, awaiting a decision. Empty: nothing to ask. */
    val findings: List<ContentFinding> = emptyList(),
    /** Indexes (into [uris]) of content matches the person chose to upload anyway; the rest are skipped. */
    val uploadAnyway: Set<Int> = emptySet(),
    val nameStrategy: NameStrategy = NameStrategy.REPLACE,
    /** Files that couldn't be read for hashing, so were compared by name only. */
    val unhashed: Int = 0,
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

    private val _foldersLoading = MutableStateFlow(false)

    /**
     * True while the folder tree is being fetched. The picker only ever observed the Room cache, so
     * before Collections had been opened once the tree was empty and the picker showed "No folders
     * yet". We now fetch on [beginReview]; this flag lets the picker show a spinner instead of the
     * empty state during that first fetch.
     */
    val foldersLoading: StateFlow<Boolean> = _foldersLoading.asStateFlow()

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
        // Set synchronously so the picker never flashes the empty state before the fetch starts.
        _foldersLoading.value = true
        loadFolders()
    }

    /**
     * Fetch the folder tree so the picker is populated regardless of whether Collections was ever
     * opened, then — matching web, which preselects the current/first folder — default the selection
     * to the first uploadable folder when nothing is selected yet (share-sheet / root-Browse entry).
     */
    private fun loadFolders() {
        viewModelScope.launch {
            runCatching { folderRepository.refresh() }
            _foldersLoading.value = false
            preselectDefaultFolder()
        }
    }

    private suspend fun preselectDefaultFolder() {
        if (_review.value?.folderId != null) return
        val first = runCatching { folderRepository.observeTree().first() }.getOrNull()
            ?.let { tree -> toPickerSections(tree).flatMap { it.folders }.firstOrNull() }
            ?: return
        _review.update { it?.copy(folderId = first.id, folderName = first.label) }
    }

    fun setFolder(id: String) {
        _review.update { it?.copy(folderId = id, folderName = null) }
    }

    private var checkJob: Job? = null

    /**
     * Hashes the picked files from their URIs, asks the server which of them are already in the library,
     * and either uploads straight away or surfaces [ReviewState.findings] for the person to decide.
     * Nothing is staged before that. If the check itself fails the upload carries on without it, as the
     * old same-name check did.
     */
    fun requestUpload() {
        val state = _review.value ?: return
        val folderId = state.folderId ?: return
        if (state.checking != null) return
        checkJob = viewModelScope.launch {
            _review.update { it?.copy(checking = HashProgress(0, state.uris.size, 0, 0)) }
            try {
                val hashes = uploadRepository.hashContents(state.uris) { progress -> _review.update { it?.copy(checking = progress) } }
                val files = state.fileNames.mapIndexed { index, name -> CheckContentFile(name, hashes[index]) }
                val findings = uploadRepository.checkContent(folderId, files)?.let { toFindings(state.fileNames, it) }.orEmpty()
                if (findings.isEmpty()) {
                    start(folderId, state.uris, conflictStrategy = null)
                } else {
                    _review.update { it?.copy(findings = findings, uploadAnyway = emptySet(), unhashed = hashes.count { h -> h == null }) }
                }
            } finally {
                _review.update { it?.copy(checking = null) }
            }
        }
    }

    fun setUploadAnyway(index: Int, upload: Boolean) {
        _review.update { state -> state?.copy(uploadAnyway = if (upload) state.uploadAnyway + index else state.uploadAnyway - index) }
    }

    fun setNameStrategy(strategy: NameStrategy) {
        _review.update { it?.copy(nameStrategy = strategy) }
    }

    /** Back from the findings to the folder choice, nothing uploaded. */
    fun cancelFindings() {
        _review.update { it?.copy(findings = emptyList(), uploadAnyway = emptySet()) }
    }

    /** Stage and upload only the files the person kept; with none left the sheet just closes. */
    fun confirmFindings() {
        val state = _review.value ?: return
        val folderId = state.folderId ?: return
        val kept = keptItems(state.uris, state.findings, state.uploadAnyway)
        if (kept.isEmpty()) return dismiss()
        val asksStrategy = state.findings.any { needsNameChoice(it, it.index in state.uploadAnyway) }
        start(folderId, kept, if (asksStrategy) state.nameStrategy.wire else null)
    }

    private fun start(folderId: String, uris: List<Uri>, conflictStrategy: String?) {
        lastUsedFolderId = folderId
        viewModelScope.launch {
            val sessionId = uploadRepository.startUpload(folderId, uris, conflictStrategy)
            _review.update { it?.copy(sessionId = sessionId, findings = emptyList()) }
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

    /**
     * Create a root-level collection from the picker's empty state. Collections aren't uploadable
     * (upload needs a folder) and can't be selected here, but the backend requires every folder to
     * live in a collection — so this is the first step for a genuinely empty account. Once created,
     * the section appears with its own "+" to add an uploadable folder.
     */
    fun createCollection(form: FolderFormData) {
        viewModelScope.launch {
            runCatching {
                val created = folderRepository.create(
                    CreateFolderRequest(
                        name = form.name,
                        parent_id = null,
                        description = form.description,
                        emoji = form.emoji,
                        type = FolderType.COLLECTION,
                    ),
                )
                if (form.isPrivate) folderRepository.update(created.id, UpdateFolderRequest(is_private = true))
            }
        }
    }

    fun dismiss() {
        checkJob?.cancel()
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
