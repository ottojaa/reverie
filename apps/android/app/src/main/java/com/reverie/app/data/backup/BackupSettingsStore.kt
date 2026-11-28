package com.reverie.app.data.backup

import androidx.datastore.core.DataMigration
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** How the backup settings are laid out in their preferences file. */
internal object BackupKeys {
    val enabled = booleanPreferencesKey("enabled")
    val bucketIds = stringSetPreferencesKey("bucket_ids")
    val folderId = stringPreferencesKey("folder_id")
    val folderName = stringPreferencesKey("folder_name")
    val addedAfter = longPreferencesKey("added_after")
    val albumFolders = stringPreferencesKey("album_folders")
    val albumProblems = stringPreferencesKey("album_problems")
    val knownAlbums = stringSetPreferencesKey("known_albums")
    val folderNotice = stringPreferencesKey("folder_notice")
    val wifiOnly = booleanPreferencesKey("wifi_only")
    val lastSuccessAt = longPreferencesKey("last_success_at")
    val lastError = stringPreferencesKey("last_error")
    val serverWait = stringPreferencesKey("server_wait")
    val libraryKey = stringPreferencesKey("library_key")
    val version = intPreferencesKey("settings_version")
}

internal fun toBackupSettings(prefs: Preferences) = BackupSettings(
    enabled = prefs[BackupKeys.enabled] ?: false,
    bucketIds = prefs.ids(BackupKeys.bucketIds),
    folderId = prefs[BackupKeys.folderId],
    folderName = prefs[BackupKeys.folderName],
    addedAfter = prefs[BackupKeys.addedAfter],
    albumFolders = prefs.albumFolders(),
    albumProblems = prefs.albumProblems(),
    knownAlbums = prefs.ids(BackupKeys.knownAlbums),
    folderNotice = prefs[BackupKeys.folderNotice],
    wifiOnly = prefs[BackupKeys.wifiOnly] ?: true,
    lastSuccessAt = prefs[BackupKeys.lastSuccessAt],
    lastError = prefs[BackupKeys.lastError],
    serverWait = prefs[BackupKeys.serverWait]?.let { Json.decodeFromString<ServerWait>(it) },
    libraryKey = prefs[BackupKeys.libraryKey],
)

/** The bucket ids stored under [key]; null when nothing is. */
internal fun Preferences.ids(key: Preferences.Key<Set<String>>): Set<Long>? =
    this[key]?.mapNotNull { it.toLongOrNull() }?.toSet()

internal fun MutablePreferences.putIds(key: Preferences.Key<Set<String>>, ids: Set<Long>) {
    this[key] = ids.map(Long::toString).toSet()
}

internal fun Preferences.albumFolders(): Map<Long, AlbumFolder> =
    this[BackupKeys.albumFolders]?.let { Json.decodeFromString<Map<Long, AlbumFolder>>(it) }.orEmpty()

internal fun MutablePreferences.putAlbumFolders(folders: Map<Long, AlbumFolder>) {
    this[BackupKeys.albumFolders] = Json.encodeToString(folders)
}

internal fun Preferences.albumProblems(): Map<Long, AlbumBlock> =
    this[BackupKeys.albumProblems]?.let { Json.decodeFromString<Map<Long, AlbumBlock>>(it) }.orEmpty()

internal fun MutablePreferences.putAlbumProblems(problems: Map<Long, AlbumBlock>) {
    this[BackupKeys.albumProblems] = Json.encodeToString(problems)
}

private const val SETTINGS_VERSION = 1

/**
 * Brings settings saved by a version that never asked what to back up. An install that was backing up
 * then was backing up everything, so it carries on doing that without being asked; the folder it
 * uploaded into becomes the backup folder, which is stored under the same keys. Anyone else is asked.
 */
internal object BackupSettingsMigration : DataMigration<Preferences> {
    override suspend fun shouldMigrate(currentData: Preferences) =
        (currentData[BackupKeys.version] ?: 0) < SETTINGS_VERSION

    override suspend fun migrate(currentData: Preferences): Preferences {
        val wasBackingUp = currentData[BackupKeys.enabled] == true &&
            currentData[BackupKeys.folderId] != null &&
            !currentData[BackupKeys.bucketIds].isNullOrEmpty()
        val next = currentData.toMutablePreferences()
        if (wasBackingUp) next[BackupKeys.addedAfter] = INCLUDE_EXISTING
        next[BackupKeys.version] = SETTINGS_VERSION
        return next.toPreferences()
    }

    override suspend fun cleanUp() = Unit
}
