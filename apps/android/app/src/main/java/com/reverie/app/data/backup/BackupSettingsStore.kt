package com.reverie.app.data.backup

import androidx.datastore.core.DataMigration
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.serialization.json.Json

/** How the backup settings are laid out in their preferences file. */
internal object BackupKeys {
    val enabled = booleanPreferencesKey("enabled")
    val bucketIds = stringSetPreferencesKey("bucket_ids")
    val folderId = stringPreferencesKey("folder_id")
    val folderName = stringPreferencesKey("folder_name")
    val addedAfter = longPreferencesKey("added_after")
    val albumFolders = stringPreferencesKey("album_folders")
    val folderNotice = stringPreferencesKey("folder_notice")
    val wifiOnly = booleanPreferencesKey("wifi_only")
    val lastSuccessAt = longPreferencesKey("last_success_at")
    val lastError = stringPreferencesKey("last_error")
    val libraryKey = stringPreferencesKey("library_key")
    val version = intPreferencesKey("settings_version")
}

internal fun toBackupSettings(prefs: Preferences) = BackupSettings(
    enabled = prefs[BackupKeys.enabled] ?: false,
    bucketIds = prefs[BackupKeys.bucketIds]?.mapNotNull { it.toLongOrNull() }?.toSet(),
    folderId = prefs[BackupKeys.folderId],
    folderName = prefs[BackupKeys.folderName],
    addedAfter = prefs[BackupKeys.addedAfter],
    albumFolders = prefs.albumFolders(),
    folderNotice = prefs[BackupKeys.folderNotice],
    wifiOnly = prefs[BackupKeys.wifiOnly] ?: true,
    lastSuccessAt = prefs[BackupKeys.lastSuccessAt],
    lastError = prefs[BackupKeys.lastError],
    libraryKey = prefs[BackupKeys.libraryKey],
)

internal fun Preferences.albumFolders(): Map<Long, AlbumFolder> =
    this[BackupKeys.albumFolders]?.let { Json.decodeFromString<Map<Long, AlbumFolder>>(it) }.orEmpty()

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
