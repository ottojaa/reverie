package com.reverie.app.data.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.reverie.app.ui.theme.ThemeMode
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "reverie_settings")

/** User-facing app settings persisted across launches. */
data class AppSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = false,
    /** Slide the bottom navigation bar away while scrolling a list. */
    val hideNavOnScroll: Boolean = false,
    /** Overrides BuildConfig.DEFAULT_SERVER_URL when non-blank. */
    val serverUrlOverride: String? = null,
    /** Original-file cache cap in bytes. */
    val fileCacheCapBytes: Long = DEFAULT_FILE_CACHE_CAP,
) {
    companion object {
        const val DEFAULT_FILE_CACHE_CAP = 500L * 1024 * 1024
    }
}

@Singleton
class SettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val themeKey = stringPreferencesKey("theme_mode")
    private val dynamicKey = booleanPreferencesKey("dynamic_color")
    private val hideNavKey = booleanPreferencesKey("hide_nav_on_scroll")
    private val serverUrlKey = stringPreferencesKey("server_url")
    private val cacheCapKey = longPreferencesKey("file_cache_cap")

    val settings: Flow<AppSettings> = context.settingsDataStore.data.map { prefs ->
        AppSettings(
            themeMode = prefs[themeKey]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.SYSTEM,
            dynamicColor = prefs[dynamicKey] ?: false,
            hideNavOnScroll = prefs[hideNavKey] ?: false,
            serverUrlOverride = prefs[serverUrlKey]?.takeIf { it.isNotBlank() },
            fileCacheCapBytes = prefs[cacheCapKey] ?: AppSettings.DEFAULT_FILE_CACHE_CAP,
        )
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.settingsDataStore.edit { it[themeKey] = mode.name }
    }

    suspend fun setDynamicColor(enabled: Boolean) {
        context.settingsDataStore.edit { it[dynamicKey] = enabled }
    }

    suspend fun setHideNavOnScroll(enabled: Boolean) {
        context.settingsDataStore.edit { it[hideNavKey] = enabled }
    }

    suspend fun setServerUrlOverride(url: String?) {
        context.settingsDataStore.edit {
            if (url.isNullOrBlank()) it.remove(serverUrlKey) else it[serverUrlKey] = url.trim()
        }
    }

    suspend fun setFileCacheCap(bytes: Long) {
        context.settingsDataStore.edit { it[cacheCapKey] = bytes }
    }
}
