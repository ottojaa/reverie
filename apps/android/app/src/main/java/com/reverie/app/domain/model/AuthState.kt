package com.reverie.app.domain.model

import com.reverie.app.data.api.model.UserDto

/** The app's top-level authentication state, driving login-vs-shell navigation. */
sealed interface AuthState {
    /** Bootstrap in progress — token store not yet read. */
    data object Unknown : AuthState
    data object LoggedOut : AuthState
    data class Authenticated(val user: UserDto) : AuthState
}
