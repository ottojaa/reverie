package com.reverie.app.data.backup

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.backupDataStore by preferencesDataStore(name = "reverie_backup")

data class BackupSettings(
    val enabled: Boolean = false,
    /** The albums to back up; null until the user (or the Camera default) has chosen. */
    val bucketIds: Set<Long>? = null,
    val folderId: String? = null,
    val folderName: String? = null,
    val wifiOnly: Boolean = true,
    val lastSuccessAt: Long? = null,
    val lastError: String? = null,
    /** Which server and user the ledger belongs to; see [BackupSettingsRepository.claimLibrary]. */
    val libraryKey: String? = null,
) {
    /** Backup only runs once it is on and has both a destination and at least one album. */
    val isReady: Boolean get() = enabled && folderId != null && !bucketIds.isNullOrEmpty()

    fun toConfig(): BackupConfig? =
        if (isReady) BackupConfig(bucketIds.orEmpty(), folderId.orEmpty()) else null
}

@Singleton
class BackupSettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val enabledKey = booleanPreferencesKey("enabled")
    private val bucketsKey = stringSetPreferencesKey("bucket_ids")
    private val folderIdKey = stringPreferencesKey("folder_id")
    private val folderNameKey = stringPreferencesKey("folder_name")
    private val wifiOnlyKey = booleanPreferencesKey("wifi_only")
    private val lastSuccessKey = longPreferencesKey("last_success_at")
    private val lastErrorKey = stringPreferencesKey("last_error")
    private val libraryKeyKey = stringPreferencesKey("library_key")

    val settings: Flow<BackupSettings> = context.backupDataStore.data.map { prefs ->
        BackupSettings(
            enabled = prefs[enabledKey] ?: false,
            bucketIds = prefs[bucketsKey]?.mapNotNull { it.toLongOrNull() }?.toSet(),
            folderId = prefs[folderIdKey],
            folderName = prefs[folderNameKey],
            wifiOnly = prefs[wifiOnlyKey] ?: true,
            lastSuccessAt = prefs[lastSuccessKey],
            lastError = prefs[lastErrorKey],
            libraryKey = prefs[libraryKeyKey],
        )
    }

    suspend fun current(): BackupSettings = settings.first()

    suspend fun setEnabled(enabled: Boolean) {
        context.backupDataStore.edit { it[enabledKey] = enabled }
    }

    suspend fun setBuckets(ids: Set<Long>) {
        context.backupDataStore.edit { it[bucketsKey] = ids.map(Long::toString).toSet() }
    }

    suspend fun setDestination(folderId: String, folderName: String) {
        context.backupDataStore.edit {
            it[folderIdKey] = folderId
            it[folderNameKey] = folderName
            it.remove(lastErrorKey)
        }
    }

    suspend fun clearDestination() {
        context.backupDataStore.edit {
            it.remove(folderIdKey)
            it.remove(folderNameKey)
        }
    }

    suspend fun setWifiOnly(wifiOnly: Boolean) {
        context.backupDataStore.edit { it[wifiOnlyKey] = wifiOnly }
    }

    suspend fun recordSuccess(at: Long) {
        context.backupDataStore.edit {
            it[lastSuccessKey] = at
            it.remove(lastErrorKey)
        }
    }

    suspend fun recordError(message: String) {
        context.backupDataStore.edit { it[lastErrorKey] = message }
    }

    suspend fun setLibraryKey(key: String) {
        context.backupDataStore.edit { it[libraryKeyKey] = key }
    }
}
