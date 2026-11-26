package com.reverie.app.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.ImageLoader
import com.reverie.app.data.local.FileCacheManager
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.data.settings.AppSettings
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.data.settings.VideoBackground
import com.reverie.app.ui.theme.ThemeMode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val settingsRepository: SettingsRepository,
    private val fileCacheManager: FileCacheManager,
    private val imageLoader: ImageLoader,
) : ViewModel() {

    val settings: StateFlow<AppSettings> = settingsRepository.settings.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = AppSettings(),
    )

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { settingsRepository.setThemeMode(mode) }
    }

    fun setDynamicColor(enabled: Boolean) {
        viewModelScope.launch { settingsRepository.setDynamicColor(enabled) }
    }

    fun setHideNavOnScroll(enabled: Boolean) {
        viewModelScope.launch { settingsRepository.setHideNavOnScroll(enabled) }
    }

    fun setMosaicFeatureEvery(every: Int) {
        viewModelScope.launch { settingsRepository.setMosaicFeatureEvery(every) }
    }

    fun setGridLayoutMode(mode: GridLayoutMode) {
        viewModelScope.launch { settingsRepository.setGridLayoutMode(mode) }
    }

    fun setVideoBackground(background: VideoBackground) {
        viewModelScope.launch { settingsRepository.setVideoBackground(background) }
    }

    /** TEMPORARY / DEV TUNING — persist the edited motion spec (whole AppSettings carries it). */
    fun setMotion(updated: AppSettings) {
        viewModelScope.launch { settingsRepository.setMotion(updated) }
    }

    /** TEMPORARY / DEV TUNING — reset all motion knobs to defaults. */
    fun resetMotion() {
        viewModelScope.launch { settingsRepository.resetMotion() }
    }

    fun setServerUrl(url: String?) {
        viewModelScope.launch {
            settingsRepository.setServerUrlOverride(url)
            authRepository.logout() // re-auth against the new server
        }
    }

    suspend fun changePassword(current: String, new: String): Result<Unit> =
        authRepository.changePassword(current, new)

    fun clearCache(onDone: () -> Unit) {
        viewModelScope.launch {
            purgeCaches()
            onDone()
        }
    }

    @OptIn(coil.annotation.ExperimentalCoilApi::class)
    private suspend fun purgeCaches() {
        fileCacheManager.clear()
        imageLoader.diskCache?.clear()
        imageLoader.memoryCache?.clear()
    }
}
