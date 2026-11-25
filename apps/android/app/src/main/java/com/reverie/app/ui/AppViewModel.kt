package com.reverie.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.settings.AppSettings
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.domain.model.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Top-level state: which auth gate to show, the theme/appearance settings, and which documents
 * every thumbnail on screen is still waiting for.
 */
@HiltViewModel
class AppViewModel @Inject constructor(
    authRepository: AuthRepository,
    settingsRepository: SettingsRepository,
    documentRepository: DocumentRepository,
) : ViewModel() {

    val authState: StateFlow<AuthState> = authRepository.authState

    val settings: StateFlow<AppSettings> = settingsRepository.settings.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = AppSettings(),
    )

    /** For [com.reverie.app.ui.components.LocalAwaitingThumbnails]. */
    val awaitingThumbnails: StateFlow<Set<String>> = documentRepository.observeAwaitingThumbnail().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(),
        initialValue = emptySet(),
    )

    init {
        viewModelScope.launch { authRepository.bootstrap() }
    }
}
