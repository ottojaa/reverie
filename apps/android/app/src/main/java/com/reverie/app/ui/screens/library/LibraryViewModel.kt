package com.reverie.app.ui.screens.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.data.backup.BackupStatusSource
import com.reverie.app.data.repository.PageResult
import com.reverie.app.data.repository.SearchRepository
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.components.createFolder
import com.reverie.app.ui.screens.browse.BROWSE_PAGE_SIZE
import com.reverie.app.ui.screens.browse.BrowseDeps
import com.reverie.app.ui.screens.browse.BrowseSession
import com.reverie.app.ui.screens.browse.DocumentListHandler
import com.reverie.app.ui.screens.browse.DownloadTarget
import com.reverie.app.ui.screens.browse.SessionUi
import com.reverie.app.ui.screens.viewer.ViewerFocus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The Library: its contents and selection, backup status, the order of its shortcuts, a new top-level folder,
 * and the viewer hand-off. */
@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val deps: BrowseDeps,
    private val search: SearchRepository,
    private val backupSource: BackupStatusSource,
) : ViewModel() {

    // One Room observer for the kind covers, Recently added and the unfinished-document watcher.
    private val cache = deps.documents.observeDocuments(DocumentScope.All)
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val session: BrowseSession = BrowseSession(
        scope = viewModelScope,
        folderId = null,
        deps = deps,
        refresh = { model.refresh() },
        onContentChanged = { model.contentChanged() },
    )

    private val model: LibraryModel = LibraryModel(
        scope = viewModelScope,
        cache = cache,
        unfiledCache = deps.documents.observeDocuments(DocumentScope.TopLevel),
        tree = deps.folders.observeTree(),
        summary = deps.documents.summary(DocumentScope.All),
        reads = RepositoryReads(deps, search),
        onFirstPageFailed = session::onRefreshFailed,
        sharing = SharingStarted.Eagerly,
    )

    private val messages = Channel<String>(Channel.BUFFERED)

    /** One-off messages for the page's snackbar. */
    val notices: Flow<String> = messages.receiveAsFlow()

    val state: StateFlow<LibraryState> get() = model.state
    val ui: StateFlow<SessionUi> get() = session.ui
    val covers: StateFlow<Map<String, FolderCoverDto>> get() = deps.folders.covers
    val unlocker get() = session.unlocker
    val favourites get() = session.favourites
    val manage get() = session.manage
    val selection get() = model.selection
    val viewerFocus: StateFlow<ViewerFocus?> get() = session.viewerFocus

    val backup: StateFlow<BackupStatus> = backupSource.observe()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BackupStatus.Unknown)

    /** The order the shortcut chips were last put in, as saved on this device; null until it has been read. */
    val shortcutOrder: StateFlow<List<String>?> = deps.settings.settings
        .map { it.shortcutOrder }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Recently added and the file rows under "My files" share one selection; each swipes through its own list. */
    val recentList: DocumentListHandler = handlerOf(LibrarySection.RECENT)
    val unfiledList: DocumentListHandler = handlerOf(LibrarySection.UNFILED)

    init {
        session.keepUnfinishedLive(cache)
    }

    /** The screen came back to the front: stars may have changed elsewhere, and photos may have been taken. */
    fun onResume() {
        favourites.load()
        backupSource.recheck()
    }

    fun refresh(initial: Boolean = false) {
        onResume()
        session.beginRefresh()
        model.refresh(initial)
    }

    fun loadMore() = model.loadMore()

    fun clearViewerFocus() = session.clearViewerFocus()

    /** Makes a folder at the top level; its row appears with the refreshed tree. */
    fun createFolder(form: FolderFormData) {
        viewModelScope.launch {
            deps.folders.createFolder(form, parentId = null)?.let { messages.send(it) }
        }
    }

    /** Saves the order the chips on show were moved into. */
    fun reorderShortcuts(shown: List<String>) {
        viewModelScope.launch {
            deps.settings.updateShortcutOrder { saved -> reorderedShortcuts(orderedShortcuts(saved), shown) }
        }
    }

    fun download(ids: List<String>, onTargets: (List<DownloadTarget>) -> Unit) = session.download(ids, onTargets)

    private fun handlerOf(section: LibrarySection) = object : DocumentListHandler {
        override val favourites get() = session.favourites

        override val selection get() = model.selection

        override fun prepareSequence(opened: DocumentDto) = session.publish(model.prepareSequence(section))

        override fun prefetch(document: DocumentDto) = session.prefetch(document)
    }
}

/** [LibraryReads] against the repositories. */
private class RepositoryReads(private val deps: BrowseDeps, private val search: SearchRepository) : LibraryReads {
    override suspend fun page(offset: Int): PageResult =
        deps.documents.refresh(DocumentScope.All, BROWSE_PAGE_SIZE, offset)

    override suspend fun unfiledPage(offset: Int): PageResult =
        deps.documents.refresh(DocumentScope.TopLevel, BROWSE_PAGE_SIZE, offset)

    override suspend fun preview(kind: DocumentKind): List<String> = deps.documents
        .refresh(DocumentScope.All, PREVIEW_COUNT, offset = 0, filter = DocumentFilter.of(kind), preview = true)
        .ids

    override suspend fun summary() {
        deps.documents.fetchSummary(DocumentScope.All)
    }

    override suspend fun folders() = deps.folders.refresh()

    override suspend fun smartViews(): List<QuickFilter> = search.fetchQuickFilters()

    override suspend fun dropStale(keep: Set<String>) =
        deps.documents.dropStale(DocumentScope.All, DocumentFilter.ALL, keep)
}
