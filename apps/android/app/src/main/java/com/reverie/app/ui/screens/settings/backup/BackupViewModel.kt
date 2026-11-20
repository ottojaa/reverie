package com.reverie.app.ui.screens.settings.backup

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderType
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
import com.reverie.app.ui.screens.collections.FolderFormData
import com.reverie.app.ui.screens.upload.FolderPickerSection
import com.reverie.app.ui.screens.upload.toPickerSections
import com.reverie.app.ui.screens.upload.withoutPrivateFolders
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
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
) : ViewModel() {

    private val device = MutableStateFlow(DeviceSnapshot())

    /** Destination choices: no private folders, since backup must not write into one. */
    val pickerSections: StateFlow<List<FolderPickerSection>> = folderRepository.observeTree()
        .map { toPickerSections(withoutPrivateFolders(it)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

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

    fun setDestination(id: String, label: String) = change { settingsRepository.setDestination(id, label) }

    /** Creates a normal (never private) folder from the picker and uses it as the destination. */
    fun createFolder(parentId: String?, form: FolderFormData) {
        viewModelScope.launch {
            val created = runCatching {
                folderRepository.create(
                    CreateFolderRequest(
                        name = form.name,
                        parent_id = parentId,
                        description = form.description,
                        emoji = form.emoji,
                        type = FolderType.FOLDER,
                    ),
                )
            }.getOrNull() ?: return@launch
            settingsRepository.setDestination(created.id, created.name)
            reapply()
        }
    }

    fun createCollection(form: FolderFormData) {
        viewModelScope.launch {
            runCatching {
                folderRepository.create(
                    CreateFolderRequest(name = form.name, description = form.description, emoji = form.emoji, type = FolderType.COLLECTION),
                )
            }
        }
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
