package com.reverie.app.ui.screens.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.UserDto
import com.reverie.app.data.backup.BackupMediaSource
import com.reverie.app.data.backup.BackupSettings
import com.reverie.app.data.backup.BackupSettingsRepository
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.data.backup.BackupStatusSource
import com.reverie.app.data.backup.toAlbums
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.domain.counted
import com.reverie.app.domain.model.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.coroutines.cancellation.CancellationException

/** Who is signed in and where their photo backup stands. */
data class AccountState(
    val user: UserDto? = null,
    val backup: BackupStatus = BackupStatus.Unknown,
    /** What backup covers, said under its status. */
    val backupDetail: String = "",
)

/** "Camera · Wi-Fi only". [album] names the one chosen album, where there is only one and it could be read. */
internal fun backupDetail(settings: BackupSettings, album: String?): String {
    if (!settings.enabled) return "Photos aren’t backed up automatically"
    if (!settings.isReady) return "Finish setting up backup"
    val albums = album ?: counted(settings.bucketIds.orEmpty().size, "album")
    val network = if (settings.wifiOnly) "Wi-Fi only" else "Any network"
    return "$albums · $network"
}

@HiltViewModel
class AccountViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val backup: BackupStatusSource,
    private val media: BackupMediaSource,
    settings: BackupSettingsRepository,
) : ViewModel() {

    val state: StateFlow<AccountState> =
        combine(auth.authState, backup.observe(), settings.settings) { session, status, current ->
            val user = (session as? AuthState.Authenticated)?.user
            AccountState(user, status, backupDetail(current, fetchAlbumName(current)))
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AccountState())

    fun recheck() = backup.recheck()

    fun signOut() {
        viewModelScope.launch { auth.logout() }
    }

    private suspend fun fetchAlbumName(settings: BackupSettings): String? {
        val chosen = settings.bucketIds?.singleOrNull() ?: return null
        if (!settings.isReady) return null
        return try {
            toAlbums(media.queryMedia()).firstOrNull { it.bucketId == chosen }?.name
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // The phone's photos can't be read just now: the albums are counted instead of named.
            null
        }
    }
}
