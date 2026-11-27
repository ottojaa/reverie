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

    /** Sets the albums to back up. One that was ticked or unticked is no longer new to the user. */
    suspend fun setBuckets(ids: Set<Long>) {
        store.edit {
            val before = it.ids(BackupKeys.bucketIds).orEmpty()
            it.ids(BackupKeys.knownAlbums)?.let { known -> it.putIds(BackupKeys.knownAlbums, known + before + ids) }
            it.putIds(BackupKeys.bucketIds, ids)
        }
    }

    /** The first look at the phone's albums: all of them count as known. Later looks change nothing. */
    suspend fun seedKnownAlbums(ids: Set<Long>) {
        store.edit { if (it[BackupKeys.knownAlbums] == null) it.putIds(BackupKeys.knownAlbums, ids) }
    }

    suspend fun markAlbumKnown(bucketId: Long) {
        store.edit { it.putIds(BackupKeys.knownAlbums, it.ids(BackupKeys.knownAlbums).orEmpty() + bucketId) }
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

    /** The folder the user picked for [bucketId], in place of its subfolder of the backup folder. */
    suspend fun chooseAlbumFolder(bucketId: Long, folderId: String, folderName: String) {
        store.edit {
            it.putAlbumFolders(it.albumFolders() + (bucketId to AlbumFolder(folderId, folderName)))
            it.putAlbumProblems(it.albumProblems() - bucketId)
        }
    }

    /** Puts [bucketId] back under the backup folder. */
    suspend fun resetAlbumFolder(bucketId: Long) {
        store.edit {
            it.putAlbumFolders(it.albumFolders() - bucketId)
            it.putAlbumProblems(it.albumProblems() - bucketId)
        }
    }

    /**
     * Takes a subfolder backup made as [bucketId]'s folder, unless the user chose one for it meanwhile.
     * Returns the folder now in force.
     */
    suspend fun adoptAlbumFolder(bucketId: Long, made: AlbumFolder): AlbumFolder {
        val after = store.edit {
            if (it.albumFolders()[bucketId]?.isChosen == true) return@edit
            it.putAlbumFolders(it.albumFolders() + (bucketId to made))
        }
        return after.albumFolders().getValue(bucketId)
    }

    /** Drops what is stored for [bucketId], if it is still [folderId]. */
    suspend fun forgetAlbumFolder(bucketId: Long, folderId: String) {
        store.edit {
            val folders = it.albumFolders()
            if (folders[bucketId]?.folderId != folderId) return@edit
            it.putAlbumFolders(folders - bucketId)
        }
    }

    suspend fun setAlbumProblem(bucketId: Long, block: AlbumBlock) {
        store.edit { it.putAlbumProblems(it.albumProblems() + (bucketId to block)) }
    }

    suspend fun clearAlbumProblem(bucketId: Long) {
        store.edit { it.putAlbumProblems(it.albumProblems() - bucketId) }
    }

    /** Drops the problems of all albums but [bucketIds]. */
    suspend fun keepAlbumProblems(bucketIds: Set<Long>) {
        store.edit { prefs -> prefs.putAlbumProblems(prefs.albumProblems().filterKeys { it in bucketIds }) }
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
