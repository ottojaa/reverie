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
import com.reverie.app.data.backup.MediaAccess
import com.reverie.app.data.backup.canReadLocation
import com.reverie.app.data.backup.isCameraAlbum
import com.reverie.app.data.backup.mediaAccess
import com.reverie.app.data.backup.scanPending
import com.reverie.app.data.backup.toAlbums
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
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
    /** Of [pending], large videos that don't fit a background run and wait for the app to be open. */
    val parkedVideos: Int = 0,
    val running: Boolean = false,
) {
    val selectedBuckets: Set<Long> get() = settings.bucketIds.orEmpty()
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

    /** Picks the folder backups go into. */
    val destinations = DestinationBrowser(folderRepository, vault, viewModelScope)

    val state: StateFlow<BackupUiState> = combine(
        settingsRepository.settings,
        device,
        dao.observeLedgerIds(),
        dao.observeRetries(),
        scheduler.observeRunning(),
    ) { settings, snapshot, ledgerIds, retries, running ->
        val pending = scanPending(snapshot.media, settings.bucketIds.orEmpty(), ledgerIds.toSet())
        val parked = retries.filter { it.cutOffs >= CUT_OFF_PARKED }.map { it.mediaId }.toSet()
        BackupUiState(
            settings = settings,
            albums = toAlbums(snapshot.media),
            access = snapshot.access,
            canReadLocation = snapshot.canReadLocation,
            pending = pending.size,
            parkedVideos = pending.count { it.id in parked },
            running = running,
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
            val media = if (access == MediaAccess.None) emptyList() else loadMedia()
            device.update { DeviceSnapshot(media, access, context.canReadLocation()) }
            preselectCamera(media)
        }
    }

    private suspend fun loadMedia(): List<BackupMedia> =
        // Access can be taken away between the check and the query.
        runCatching { mediaSource.queryMedia() }.getOrDefault(emptyList())

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

    fun toggleAlbum(bucketId: Long) {
        viewModelScope.launch {
            val before = settingsRepository.current()
            val current = before.bucketIds.orEmpty()
            settingsRepository.setBuckets(if (bucketId in current) current - bucketId else current + bucketId)
            // With no album the works were cancelled, so ticking one has to arm them again. Otherwise they
            // already match the settings (re-applying would restart a running pass); a run picks up the new album.
            if (before.toConfig() == null) reapply()
            scheduler.scheduleContinuation(settingsRepository.current())
        }
    }

    /** Opens the destination browser: a folder is required, and never a private one. */
    fun pickDestination() {
        destinations.show(
            DestinationRules(allowPrivate = false, allowTop = false),
            startAt = state.value.settings.folderId,
        )
    }

    fun setDestination(destination: Destination) {
        val folderId = destination.folderId ?: return
        change { settingsRepository.setDestination(folderId, destination.name) }
    }

    fun backUpNow() {
        viewModelScope.launch { scheduler.backUpNow(settingsRepository.current()) }
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
