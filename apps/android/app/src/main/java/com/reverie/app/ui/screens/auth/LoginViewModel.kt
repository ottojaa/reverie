package com.reverie.app.ui.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.data.settings.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val serverUrl: String = "",
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val settingsRepository: SettingsRepository,
    private val serverUrlProvider: ServerUrlProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState(serverUrl = displayUrl()))
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onEmailChange(value: String) = _uiState.update { it.copy(email = value, error = null) }

    fun onPasswordChange(value: String) = _uiState.update { it.copy(password = value, error = null) }

    fun submit() {
        val state = _uiState.value
        if (state.isLoading || state.email.isBlank() || state.password.isBlank()) return

        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            val result = authRepository.login(state.email, state.password)
            // Always clear the spinner. On success the shell (MainActivity) usually swaps this
            // screen out, but LoginScreen is hosted directly there (not a nav destination), so this
            // ViewModel is Activity-scoped and survives an Authenticated→LoggedOut flip. If the
            // session is torn down again right after a successful login, a stale isLoading=true
            // would strand the button spinning until the app restarts.
            _uiState.update {
                it.copy(isLoading = false, error = result.exceptionOrNull()?.let(::messageFor))
            }
        }
    }

    fun setServerUrl(url: String) {
        viewModelScope.launch {
            settingsRepository.setServerUrlOverride(url.ifBlank { null })
            _uiState.update { it.copy(serverUrl = url.ifBlank { displayUrl() }.removeSuffix("/")) }
        }
    }

    private fun displayUrl(): String = serverUrlProvider.current().removeSuffix("/")

    private fun messageFor(throwable: Throwable): String =
        (throwable as? ReverieApiException)?.userMessage()
            ?: "Sign-in failed. Please try again."
}
