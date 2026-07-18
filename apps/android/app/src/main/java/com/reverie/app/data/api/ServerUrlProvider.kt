package com.reverie.app.data.api

import com.reverie.app.BuildConfig
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The resolved API base URL: the user's Settings override when set, otherwise the
 * per-build-type default. Kept in a [StateFlow] so the Ktor client can read the current
 * value synchronously per request — a Settings change re-targets the client without a restart.
 * Always normalised to end with a single "/" so relative request paths resolve correctly.
 */
@Singleton
class ServerUrlProvider @Inject constructor(
    settingsRepository: SettingsRepository,
    @ApplicationScope scope: CoroutineScope,
) {
    private val _base = MutableStateFlow(normalize(BuildConfig.DEFAULT_SERVER_URL))
    val base: StateFlow<String> = _base.asStateFlow()

    init {
        scope.launch {
            settingsRepository.settings.collect { settings ->
                _base.value = normalize(settings.serverUrlOverride ?: BuildConfig.DEFAULT_SERVER_URL)
            }
        }
    }

    fun current(): String = _base.value

    private fun normalize(url: String): String = url.trim().removeSuffix("/") + "/"
}
