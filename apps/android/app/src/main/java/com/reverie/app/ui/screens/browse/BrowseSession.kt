package com.reverie.app.ui.screens.browse

import android.content.Context
import coil.ImageLoader
import coil.request.ImageRequest
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.isStillProcessing
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.processing.ProcessingTracker
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.UploadRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.favourites.FavouriteDeps
import com.reverie.app.ui.screens.manage.ManageController
import com.reverie.app.ui.screens.viewer.DocumentSequence
import com.reverie.app.ui.screens.viewer.DocumentSequenceHolder
import com.reverie.app.ui.screens.viewer.ViewerFocus
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** A resolved, ready-to-enqueue download: a signed file URL + the name to save it under. */
data class DownloadTarget(val url: String, val filename: String)

/** What the Browse screens show around their lists: the folder, connectivity, processing and any load error. */
data class SessionUi(
    val folder: FolderDto? = null,
    val isOffline: Boolean = false,
    val processingCount: Int = 0,
    val error: String? = null,
    /** Set when the server refused the list with FOLDER_LOCKED: the lock that must be opened first. */
    val lockedFolderId: String? = null,
)

/** Everything a [BrowseSession] reads from, bundled so each Browse view model injects one thing. */
@Singleton
class BrowseDeps @Inject constructor(
    val documents: DocumentRepository,
    val folders: FolderRepository,
    val vault: VaultRepository,
    val processing: ProcessingTracker,
    val connectivity: ConnectivityMonitor,
    val serverUrl: ServerUrlProvider,
    val sequenceHolder: DocumentSequenceHolder,
    val imageLoader: ImageLoader,
    val uploads: UploadRepository,
    val settings: SettingsRepository,
    val favouriteDeps: FavouriteDeps,
    @ApplicationContext val appContext: Context,
)

private data class SessionControl(val error: String? = null, val lockedFolderId: String? = null)

/**
 * What the Library, a folder page and a list screen do the same way, held once: the lock prompt and
 * load errors, the viewer hand-off, changing what is selected, downloading it, the document warm-up, the
 * processing watchers, the grid settings, and the signals that the library changed (a delete or a move
 * anywhere, uploads finishing).
 *
 * [folderId] is the folder the screen shows, if it shows one; [showsFolders] that it draws folder rows from
 * the tree, which the root's page does without being a folder. The owner (a view model) passes [refresh] to re-read after a password unlock, and [onContentChanged] for
 * what it re-reads when the library changes.
 */
class BrowseSession(
    private val scope: CoroutineScope,
    val folderId: String?,
    private val deps: BrowseDeps,
    refresh: () -> Unit,
    private val onContentChanged: () -> Unit,
    private val showsFolders: Boolean = folderId != null,
) {
    private val control = MutableStateFlow(SessionControl())

    private val folder: Flow<FolderDto?> = if (folderId != null) deps.folders.observeFolder(folderId) else flowOf(null)

    val ui: StateFlow<SessionUi> = combine(
        folder, deps.connectivity.isOnline, control, deps.processing.count,
    ) { folder, online, ctrl, processing ->
        SessionUi(folder, isOffline = !online, processingCount = processing, error = ctrl.error, lockedFolderId = ctrl.lockedFolderId)
    }.stateIn(scope, SharingStarted.WhileSubscribed(5_000), SessionUi())

    /** Password prompt for a locked folder; a successful unlock re-fetches the list and the tree. */
    val unlocker = FolderUnlocker(deps.vault, scope) {
        // The lock is open: stop showing it, and let the new read set it again if the server still refuses.
        beginRefresh()
        refresh()
        runCatching { deps.folders.refresh() }
    }

    /** Starring and opening favourites from this screen. */
    val favourites = FavouriteController(deps.favouriteDeps, scope)

    /** What the selection bar does to documents and folders. */
    val manage = ManageController(deps.folders, deps.documents, deps.vault, favourites, scope)

    /** How a photo grid arranges its tiles (user setting). */
    val gridLayoutMode: StateFlow<GridLayoutMode> = deps.settings.settings
        .map { it.gridLayoutMode }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), GridLayoutMode.UNIFORM)

    /** How often the mosaic grid promotes a photo to a larger tile (user setting). */
    val mosaicFeatureEvery: StateFlow<Int> = deps.settings.settings
        .map { it.mosaicFeatureEvery }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), 3)

    /** What the viewer is showing, so the list it was opened from can scroll to it on return. */
    val viewerFocus: StateFlow<ViewerFocus?> get() = deps.sequenceHolder.focus

    init {
        deps.processing.refresh()
        refreshFolders()
        watchContentChanges()
        // Badges and menu wording need the list, whichever screen is the first to want it.
        if (!favourites.state.value.isLoaded) favourites.load()
    }

    /** Consume the focus signal once the list has scrolled to it, so later list updates don't re-scroll. */
    fun clearViewerFocus() = deps.sequenceHolder.setFocus(null)

    /** Hand [sequence] to the viewer so it can swipe through it. Call right before navigating into a document. */
    fun publish(sequence: DocumentSequence) = deps.sequenceHolder.set(sequence)

    /**
     * Warm the tapped document ahead of the dive so the viewer opens on the sharp image instead of the
     * stretched thumbnail: resolve (and cache app-wide) the signed URL now, and for images kick off the
     * full-res download into Coil's cache, both overlapping the open transition.
     */
    fun prefetch(document: DocumentDto) {
        // Private originals must not land in Coil's disk cache, and the viewer fetches them itself.
        if (document.is_private) return
        scope.launch {
            val raw = deps.documents.fileUrl(document.id) ?: return@launch
            if (DocumentKind.of(document.mime_type) == DocumentKind.IMAGE) {
                deps.imageLoader.enqueue(ImageRequest.Builder(deps.appContext).data(deps.serverUrl.toAbsolute(raw)).build())
            }
        }
    }

    /** A new read of the list starts: forget the last error and lock. */
    fun beginRefresh() {
        deps.processing.refresh()
        control.update { SessionControl() }
    }

    /** Re-reads the folder tree for a folder page, whose rows and counts come from it. Offline, the cached one stays. */
    fun refreshFolders() {
        if (!showsFolders) return
        scope.launch { runCatching { deps.folders.refresh() } }
    }

    /** The first page (or a refresh) of a list failed. A closed lock asks for the password; offline is not an error. */
    fun onRefreshFailed(throwable: Throwable) {
        val lockedId = (throwable as? ReverieApiException)?.lockedFolderId()
        if (lockedId != null) unlocker.request(lockedId, ui.value.folder?.name)
        control.update {
            SessionControl(
                lockedFolderId = lockedId,
                error = if (lockedId == null && deps.connectivity.currentlyOnline()) messageFor(throwable) else null,
            )
        }
    }

    /**
     * Adds what [cache] shows that the processing tracker might not cover (private-folder documents, a
     * long backlog) to the tracker's live set, so thumbnails still appear as they finish.
     */
    fun keepUnfinishedLive(cache: Flow<List<DocumentDto>>) {
        scope.launch {
            val unfinished = cache
                .map { docs -> docs.filter(DocumentDto::isStillProcessing).map(DocumentDto::id).toSet() }
                .distinctUntilChanged()
            deps.processing.keepLive(unfinished)
        }
    }

    /**
     * Resolve fresh signed URLs for the documents [ids] (the cached copies strip file_url) and
     * hand them to [onTargets] to enqueue; the caller owns the platform DownloadManager.
     */
    fun download(ids: List<String>, onTargets: (List<DownloadTarget>) -> Unit) {
        scope.launch {
            val targets = ids.mapNotNull { id ->
                runCatching {
                    val doc = deps.documents.fetchDocument(id)
                    doc.file_url?.let { DownloadTarget(deps.serverUrl.toAbsolute(it), doc.original_filename) }
                }.getOrNull()
            }
            onTargets(targets)
        }
    }

    /**
     * A screen stays alive while another is on top of it, so a change made on any of them, or uploads finishing
     * (once, when the last one is done, not per file), must reach them all.
     */
    private fun watchContentChanges() {
        scope.launch { deps.documents.contentChanges.collect { changed() } }
        scope.launch {
            var wasUploading = false
            deps.uploads.observeActiveCount().collect { active ->
                if (active == 0 && wasUploading) changed()
                wasUploading = active > 0
            }
        }
    }

    private fun changed() {
        beginRefresh()
        refreshFolders()
        onContentChanged()
    }

    private fun messageFor(throwable: Throwable): String =
        (throwable as? ReverieApiException)?.userMessage() ?: "Couldn't load your files."
}
