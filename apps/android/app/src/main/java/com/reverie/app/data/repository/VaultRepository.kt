package com.reverie.app.data.repository

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.VaultApi
import com.reverie.app.data.api.model.LockSecret
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VaultRepository @Inject constructor(
    private val vaultApi: VaultApi,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    private val unlockFlow = MutableSharedFlow<Unit>(extraBufferCapacity = 8)

    /** Fires each time a lock is opened, so what depends on the open locks can be read again. */
    val unlocks: SharedFlow<Unit> = unlockFlow.asSharedFlow()

    private val lastStatus = MutableStateFlow<VaultStatus?>(null)

    /**
     * The newest the app has heard about how locks open, for wording screens. Another device can change it at any
     * time, so whatever takes a try or a save reads it afresh with [fetchStatus].
     */
    val status: StateFlow<VaultStatus?> = lastStatus.asStateFlow()

    /** How locks open now. Null when it can't be determined (offline). */
    suspend fun fetchStatus(): VaultStatus? = withContext(io) {
        try {
            vaultApi.status().also { lastStatus.value = it }
        } catch (e: ReverieApiException) {
            null
        } catch (e: IOException) {
            null
        }
    }

    /**
     * Open the lock around [folderId], a private folder covering everything under it, with what was [typed]. The
     * server remembers it in the session cookie; callers refetch the tree/list after.
     */
    suspend fun unlock(folderId: String, typed: String): UnlockOutcome = withContext(io) {
        try {
            lastStatus.value = vaultApi.unlock(folderId, typed)
            unlockFlow.tryEmit(Unit)
            UnlockOutcome.Unlocked
        } catch (e: ReverieApiException) {
            onRefusedTry(e)
        } catch (e: IOException) {
            onRefusedTry(ReverieApiException.Network(e))
        }
    }

    /** Sets or changes the lock secret, or removes it with a null [secret]. The account password proves it. */
    suspend fun saveSecret(accountPassword: String, secret: LockSecret?): SaveSecretOutcome = withContext(io) {
        try {
            val saved = vaultApi.saveSecret(accountPassword, secret)
            lastStatus.value = saved
            SaveSecretOutcome.Saved(saved)
        } catch (e: ReverieApiException) {
            e.toSaveSecretOutcome()
        } catch (e: IOException) {
            ReverieApiException.Network(e).toSaveSecretOutcome()
        }
    }

    private fun onRefusedTry(error: ReverieApiException): UnlockOutcome {
        val outcome = error.toUnlockOutcome()
        lastStatus.update { it?.afterRefusal(outcome) }
        return outcome
    }

    /** The session ended: the next one may be another account's. */
    fun forgetStatus() {
        lastStatus.value = null
    }
}
