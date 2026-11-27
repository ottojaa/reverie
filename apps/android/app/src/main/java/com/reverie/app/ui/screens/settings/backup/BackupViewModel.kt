package com.reverie.app.ui.screens.settings.backup

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.data.backup.BackupMedia
import com.reverie.app.data.backup.BackupMediaSource
import com.reverie.app.data.backup.BackupScheduler
import com.reverie.app.data.backup.BackupSettings
import com.reverie.app.data.backup.BackupSettingsRepository
import com.reverie.app.data.backup.CUT_OFF_PARKED
import com.reverie.app.data.backup.INCLUDE_EXISTING
import com.reverie.app.data.backup.MediaAccess
import com.reverie.app.data.backup.canReadLocation
import com.reverie.app.data.backup.isCameraAlbum
import com.reverie.app.data.backup.mediaAccess
import com.reverie.app.data.backup.newAlbums
import com.reverie.app.data.backup.scanPending
import com.reverie.app.data.backup.toAlbums
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.data.local.entity.BackupRetryEntity
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.screens.destination.Destination
import com.reverie.app.ui.screens.destination.DestinationBrowser
import com.reverie.app.ui.screens.destination.DestinationRules
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the backup screen shows; see [BackupViewModel.state]. */
data class BackupUiState(
    val settings: BackupSettings = BackupSettings(),
    val albums: List<BackupAlbum> = emptyList(),
    val access: MediaAccess = MediaAccess.None,
    val canReadLocation: Boolean = true,
    /** Files in the chosen albums that are still to be handled. */
    val pending: Int = 0,
    /** Files in the chosen albums that were on the phone before the cutoff, so wait to be included. */
    val leftAlone: Int = 0,
    /** Of [pending], large videos that don't fit a background run and wait for the app to be open. */
    val parkedVideos: Int = 0,
    val running: Boolean = false,
    val destinations: BackupDestinations = BackupDestinations(),
) {
    val selectedBuckets: Set<Long> get() = settings.bucketIds.orEmpty()

    /** Albums that appeared on the phone and haven't been answered for. */
    val newAlbums: List<BackupAlbum> get() = newAlbums(albums, settings)

    /** On, with something to back up, and no answer yet on whether that includes what is already there. */
    val needsChoice: Boolean
        get() = settings.enabled && settings.addedAfter == null && selectedBuckets.isNotEmpty() && access != MediaAccess.None
}

@HiltViewModel
class BackupViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val settingsRepository: BackupSettingsRepository,
    private val scheduler: BackupScheduler,
    private val mediaSource: BackupMediaSource,
    private val dao: BackupDao,
    private val folderRepository: FolderRepository,
    vault: VaultRepository,
) : ViewModel() {

    private val device = MutableStateFlow(DeviceSnapshot())

    /** Picks the backup folder, or one album's. */
    val destinations = DestinationBrowser(folderRepository, vault, viewModelScope)

    /** The album [destinations] is picking a folder for; null while it picks the backup folder. */
    private var pickingFor: Long? = null

    val state: StateFlow<BackupUiState> = combine(
        combine(settingsRepository.settings, folderRepository.observeTree(), ::Pair),
        device,
        dao.observeLedgerIds(),
        dao.observeRetries(),
        scheduler.observeRunning(),
    ) { (settings, folders), snapshot, ledgerIds, retries, running ->
        toUiState(settings, snapshot, ledgerIds.toSet(), retries).copy(
            running = running,
            destinations = toBackupDestinations(settings, toAlbums(snapshot.media), FolderTree(folders)),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BackupUiState())

    init {
        refresh()
        viewModelScope.launch { runCatching { folderRepository.refresh() } }
    }

    /** Reads what the device has and which permissions are granted; call on open and after a permission answer. */
    fun refresh() {
        viewModelScope.launch {
            val access = context.mediaAccess()
            val read = if (access == MediaAccess.None) null else loadMedia()
            val media = read.orEmpty()
            device.update { DeviceSnapshot(media, access, context.canReadLocation()) }
            // Only a complete listing may count as the first look: what it misses would be announced later.
            if (access == MediaAccess.Full && read != null) {
                settingsRepository.seedKnownAlbums(read.map { it.bucketId }.toSet())
            }
            preselectCamera(media)
        }
    }

    private fun toUiState(
        settings: BackupSettings,
        snapshot: DeviceSnapshot,
        ledgerIds: Set<Long>,
        retries: List<BackupRetryEntity>,
    ): BackupUiState {
        val buckets = settings.bucketIds.orEmpty()
        val unhandled = scanPending(snapshot.media, buckets, ledgerIds, INCLUDE_EXISTING)
        val pending = scanPending(snapshot.media, buckets, ledgerIds, settings.addedAfter ?: INCLUDE_EXISTING)
        val parked = retries.filter { it.cutOffs >= CUT_OFF_PARKED }.map { it.mediaId }.toSet()
        return BackupUiState(
            settings = settings,
            albums = toAlbums(snapshot.media),
            access = snapshot.access,
            canReadLocation = snapshot.canReadLocation,
            pending = pending.size,
            // Before the choice is made, including what is there would back up all of it.
            leftAlone = if (settings.addedAfter == null) unhandled.size else unhandled.size - pending.size,
            parkedVideos = pending.count { it.id in parked },
        )
    }

    /** Null when the phone's media can't be read: access can be taken away between the check and the query. */
    private suspend fun loadMedia(): List<BackupMedia>? = runCatching { mediaSource.queryMedia() }.getOrNull()

    /** The first time, the camera roll is selected for the person; they can change it. */
    private suspend fun preselectCamera(media: List<BackupMedia>) {
        if (settingsRepository.current().bucketIds != null) return
        val camera = toAlbums(media).filter(::isCameraAlbum).map { it.bucketId }.toSet()
        if (camera.isEmpty()) return
        settingsRepository.setBuckets(camera)
        scheduler.apply(settingsRepository.current())
    }

    fun onPermissionsAnswered() {
        refresh()
        change { }
    }

    fun setEnabled(enabled: Boolean) = change { settingsRepository.setEnabled(enabled) }

    fun setWifiOnly(wifiOnly: Boolean) = change { settingsRepository.setWifiOnly(wifiOnly) }

    fun toggleAlbum(bucketId: Long) = widen {
        val current = settingsRepository.current().bucketIds.orEmpty()
        settingsRepository.setBuckets(if (bucketId in current) current - bucketId else current + bucketId)
    }

    fun backUpNewAlbum(bucketId: Long) = widen {
        settingsRepository.setBuckets(settingsRepository.current().bucketIds.orEmpty() + bucketId)
    }

    fun dismissNewAlbum(bucketId: Long) {
        viewModelScope.launch { settingsRepository.markAlbumKnown(bucketId) }
    }

    /** Leaves what is on the phone now alone and backs up what is added from here on. */
    fun backUpOnlyNew() = change { settingsRepository.backUpOnlyNew(System.currentTimeMillis() / 1_000) }

    /** Backs up what was already on the phone too. */
    fun includeExisting() = widen { settingsRepository.includeExisting() }

    fun dismissFolderNotice() {
        viewModelScope.launch { settingsRepository.dismissFolderNotice() }
    }

    fun pickDestination() = showFolderPicker(albumId = null, startAt = state.value.settings.folderId)

    fun pickAlbumFolder(bucketId: Long) {
        val settings = state.value.settings
        showFolderPicker(bucketId, startAt = settings.albumFolder(bucketId)?.folderId ?: settings.folderId)
    }

    /** Opens the destination browser: a folder is required, and never a private one. */
    private fun showFolderPicker(albumId: Long?, startAt: String?) {
        pickingFor = albumId
        destinations.show(DestinationRules(allowPrivate = false, allowTop = false), startAt)
    }

    /** Takes the picked folder for what the browser was opened for. */
    fun setDestination(destination: Destination) {
        val folderId = destination.folderId ?: return
        val albumId = pickingFor
        if (albumId == null) {
            change { settingsRepository.setDestination(folderId, destination.name) }
            return
        }
        widen { settingsRepository.chooseAlbumFolder(albumId, folderId, destination.name) }
    }

    /** Puts the album back under the backup folder. */
    fun resetAlbumFolder(bucketId: Long) = widen { settingsRepository.resetAlbumFolder(bucketId) }

    fun backUpNow() {
        viewModelScope.launch { scheduler.backUpNow(settingsRepository.current()) }
    }

    /** Applies an edit that can give backup more to do, and queues a run for it. */
    private fun widen(edit: suspend () -> Unit) {
        viewModelScope.launch {
            val wasReady = settingsRepository.current().isReady
            edit()
            // Works that weren't ready were cancelled, so they have to be armed again. Otherwise they already
            // match the settings (re-applying would restart a running pass); the queued run picks up the change.
            if (!wasReady) reapply()
            scheduler.scheduleContinuation(settingsRepository.current())
        }
    }

    private fun change(edit: suspend () -> Unit) {
        viewModelScope.launch {
            edit()
            reapply()
        }
    }

    private suspend fun reapply() = scheduler.apply(settingsRepository.current())

    private data class DeviceSnapshot(
        val media: List<BackupMedia> = emptyList(),
        val access: MediaAccess = MediaAccess.None,
        val canReadLocation: Boolean = true,
    )
}
