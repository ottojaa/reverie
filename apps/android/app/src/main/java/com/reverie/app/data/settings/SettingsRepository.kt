package com.reverie.app.data.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
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

/** How the Files grid lays photos out. */
enum class GridLayoutMode {
    /** Google-Photos-style: mostly 1×1 with occasional larger feature tiles. */
    MOSAIC,
    /** Rows scaled to fill the width, each photo at its natural aspect ratio. */
    JUSTIFIED,
    /** A plain uniform grid — every tile the same square. */
    UNIFORM,
}

/** User-facing app settings persisted across launches. */
data class AppSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = false,
    /** Slide the bottom navigation bar away while scrolling a list. */
    val hideNavOnScroll: Boolean = true,
    /** Number of columns in the Files grid (1–4). */
    val gridColumns: Int = 3,
    /** How the Files grid arranges photos. */
    val gridLayoutMode: GridLayoutMode = GridLayoutMode.MOSAIC,
    /** Mosaic Files grid: a larger feature tile appears roughly every N photos (min 2). */
    val mosaicFeatureEvery: Int = 3,
    /** Overrides BuildConfig.DEFAULT_SERVER_URL when non-blank. */
    val serverUrlOverride: String? = null,
    /** Original-file cache cap in bytes. */
    val fileCacheCapBytes: Long = DEFAULT_FILE_CACHE_CAP,
    // TEMPORARY / DEV TUNING — motion parameters editable from the debug-only "Animation settings"
    // card. Bridged into MotionTuning.spec (see MotionSpec.kt). Delete with that card.
    val motionNavMs: Int = 310,
    val motionDirectionalEasing: String = "FAST_OUT_SLOW_IN",
    val motionSlideFraction: Float = 0.10f,
    val motionPopScale: Float = 0.85f,
    val motionDiveMs: Int = 300,
    val motionDiveEasing: String = "EMPHASIZED",
    val motionBarEnterMs: Int = 280,
    val motionToolbarExitMs: Int = 280,
) {
    companion object {
        const val DEFAULT_FILE_CACHE_CAP = 500L * 1024 * 1024
    }
}

/** Bounds for the mosaic feature-frequency setting (photos between large tiles). */
const val MOSAIC_FEATURE_EVERY_MIN = 2
const val MOSAIC_FEATURE_EVERY_MAX = 12

@Singleton
class SettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val themeKey = stringPreferencesKey("theme_mode")
    private val dynamicKey = booleanPreferencesKey("dynamic_color")
    private val hideNavKey = booleanPreferencesKey("hide_nav_on_scroll")
    private val gridColumnsKey = intPreferencesKey("grid_columns")
    private val gridLayoutModeKey = stringPreferencesKey("grid_layout_mode")
    private val mosaicFeatureEveryKey = intPreferencesKey("mosaic_feature_every")
    private val serverUrlKey = stringPreferencesKey("server_url")
    private val cacheCapKey = longPreferencesKey("file_cache_cap")
    // TEMPORARY / DEV TUNING keys (see AppSettings motion fields).
    private val motionNavMsKey = intPreferencesKey("motion_nav_ms")
    private val motionDirEasingKey = stringPreferencesKey("motion_dir_easing")
    private val motionSlideFractionKey = floatPreferencesKey("motion_slide_fraction")
    private val motionPopScaleKey = floatPreferencesKey("motion_pop_scale")
    private val motionDiveMsKey = intPreferencesKey("motion_dive_ms")
    private val motionDiveEasingKey = stringPreferencesKey("motion_dive_easing")
    private val motionBarEnterMsKey = intPreferencesKey("motion_bar_enter_ms")
    private val motionToolbarExitMsKey = intPreferencesKey("motion_toolbar_exit_ms")

    val settings: Flow<AppSettings> = context.settingsDataStore.data.map { prefs ->
        val defaults = AppSettings()
        AppSettings(
            themeMode = prefs[themeKey]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.SYSTEM,
            dynamicColor = prefs[dynamicKey] ?: false,
            hideNavOnScroll = prefs[hideNavKey] ?: defaults.hideNavOnScroll,
            gridColumns = (prefs[gridColumnsKey] ?: defaults.gridColumns).coerceIn(1, 4),
            gridLayoutMode = prefs[gridLayoutModeKey]?.let { runCatching { GridLayoutMode.valueOf(it) }.getOrNull() } ?: defaults.gridLayoutMode,
            mosaicFeatureEvery = (prefs[mosaicFeatureEveryKey] ?: defaults.mosaicFeatureEvery).coerceIn(MOSAIC_FEATURE_EVERY_MIN, MOSAIC_FEATURE_EVERY_MAX),
            serverUrlOverride = prefs[serverUrlKey]?.takeIf { it.isNotBlank() },
            fileCacheCapBytes = prefs[cacheCapKey] ?: AppSettings.DEFAULT_FILE_CACHE_CAP,
            motionNavMs = prefs[motionNavMsKey] ?: defaults.motionNavMs,
            motionDirectionalEasing = prefs[motionDirEasingKey] ?: defaults.motionDirectionalEasing,
            motionSlideFraction = prefs[motionSlideFractionKey] ?: defaults.motionSlideFraction,
            motionPopScale = prefs[motionPopScaleKey] ?: defaults.motionPopScale,
            motionDiveMs = prefs[motionDiveMsKey] ?: defaults.motionDiveMs,
            motionDiveEasing = prefs[motionDiveEasingKey] ?: defaults.motionDiveEasing,
            motionBarEnterMs = prefs[motionBarEnterMsKey] ?: defaults.motionBarEnterMs,
            motionToolbarExitMs = prefs[motionToolbarExitMsKey] ?: defaults.motionToolbarExitMs,
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

    suspend fun setGridColumns(columns: Int) {
        context.settingsDataStore.edit { it[gridColumnsKey] = columns.coerceIn(1, 4) }
    }

    suspend fun setGridLayoutMode(mode: GridLayoutMode) {
        context.settingsDataStore.edit { it[gridLayoutModeKey] = mode.name }
    }

    suspend fun setMosaicFeatureEvery(every: Int) {
        context.settingsDataStore.edit { it[mosaicFeatureEveryKey] = every.coerceIn(MOSAIC_FEATURE_EVERY_MIN, MOSAIC_FEATURE_EVERY_MAX) }
    }

    suspend fun setServerUrlOverride(url: String?) {
        context.settingsDataStore.edit {
            if (url.isNullOrBlank()) it.remove(serverUrlKey) else it[serverUrlKey] = url.trim()
        }
    }

    suspend fun setFileCacheCap(bytes: Long) {
        context.settingsDataStore.edit { it[cacheCapKey] = bytes }
    }

    /** TEMPORARY / DEV TUNING — persist all motion knobs from the debug "Motion (dev)" card. */
    suspend fun setMotion(s: AppSettings) {
        context.settingsDataStore.edit {
            it[motionNavMsKey] = s.motionNavMs
            it[motionDirEasingKey] = s.motionDirectionalEasing
            it[motionSlideFractionKey] = s.motionSlideFraction
            it[motionPopScaleKey] = s.motionPopScale
            it[motionDiveMsKey] = s.motionDiveMs
            it[motionDiveEasingKey] = s.motionDiveEasing
            it[motionBarEnterMsKey] = s.motionBarEnterMs
            it[motionToolbarExitMsKey] = s.motionToolbarExitMs
        }
    }

    /** TEMPORARY / DEV TUNING — clear all persisted motion knobs (reset to defaults). */
    suspend fun resetMotion() {
        context.settingsDataStore.edit {
            it.remove(motionNavMsKey)
            it.remove(motionDirEasingKey)
            it.remove(motionSlideFractionKey)
            it.remove(motionPopScaleKey)
            it.remove(motionDiveMsKey)
            it.remove(motionDiveEasingKey)
            it.remove(motionBarEnterMsKey)
            it.remove(motionToolbarExitMsKey)
        }
    }
}
