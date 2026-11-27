package com.reverie.app.data.backup

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

private val Context.backupDataStore by preferencesDataStore(
    name = "reverie_backup",
    produceMigrations = { listOf(BackupSettingsMigration) },
)

@Singleton
class BackupSettingsRepository internal constructor(private val store: DataStore<Preferences>) {

    @Inject
    constructor(@ApplicationContext context: Context) : this(context.backupDataStore)

    val settings: Flow<BackupSettings> = store.data.map(::toBackupSettings)

    suspend fun current(): BackupSettings = settings.first()

    suspend fun setEnabled(enabled: Boolean) {
        store.edit { it[BackupKeys.enabled] = enabled }
    }

    suspend fun setBuckets(ids: Set<Long>) {
        store.edit { it[BackupKeys.bucketIds] = ids.map(Long::toString).toSet() }
    }

    /** The backup folder the user picked. */
    suspend fun setDestination(folderId: String, folderName: String) {
        store.edit {
            it[BackupKeys.folderId] = folderId
            it[BackupKeys.folderName] = folderName
            it.remove(BackupKeys.folderNotice)
            it.remove(BackupKeys.lastError)
        }
    }

    /**
     * Takes a folder backup made as the backup folder, unless that is no longer [replacing] (the user
     * picked another meanwhile). Returns the id of the backup folder now in force.
     */
    suspend fun adoptBackupFolder(folderId: String, folderName: String, replacing: String?, notice: String?): String {
        val after = store.edit {
            if (it[BackupKeys.folderId] != replacing) return@edit
            it[BackupKeys.folderId] = folderId
            it[BackupKeys.folderName] = folderName
            if (notice != null) it[BackupKeys.folderNotice] = notice
        }
        return after[BackupKeys.folderId] ?: folderId
    }

    suspend fun setAlbumFolder(bucketId: Long, folder: AlbumFolder) {
        store.edit { it[BackupKeys.albumFolders] = Json.encodeToString(it.albumFolders() + (bucketId to folder)) }
    }

    /** Drops what is stored for [bucketId], if it is still [folderId]. */
    suspend fun forgetAlbumFolder(bucketId: Long, folderId: String) {
        store.edit {
            val folders = it.albumFolders()
            if (folders[bucketId]?.folderId != folderId) return@edit
            it[BackupKeys.albumFolders] = Json.encodeToString(folders - bucketId)
        }
    }

    suspend fun dismissFolderNotice() {
        store.edit { it.remove(BackupKeys.folderNotice) }
    }

    /** Leaves alone what was on the phone before [since] (epoch seconds). Does nothing once a choice is made. */
    suspend fun backUpOnlyNew(since: Long) {
        store.edit { if (it[BackupKeys.addedAfter] == null) it[BackupKeys.addedAfter] = since }
    }

    suspend fun includeExisting() {
        store.edit { it[BackupKeys.addedAfter] = INCLUDE_EXISTING }
    }

    suspend fun setWifiOnly(wifiOnly: Boolean) {
        store.edit { it[BackupKeys.wifiOnly] = wifiOnly }
    }

    suspend fun recordSuccess(at: Long) {
        store.edit {
            it[BackupKeys.lastSuccessAt] = at
            it.remove(BackupKeys.lastError)
        }
    }

    suspend fun recordError(message: String) {
        store.edit { it[BackupKeys.lastError] = message }
    }

    suspend fun setLibraryKey(key: String) {
        store.edit { it[BackupKeys.libraryKey] = key }
    }
}
