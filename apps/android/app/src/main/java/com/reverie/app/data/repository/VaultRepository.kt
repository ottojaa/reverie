package com.reverie.app.data.repository

import com.reverie.app.data.api.VaultApi
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VaultRepository @Inject constructor(
    private val vaultApi: VaultApi,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    private val _status = MutableStateFlow<VaultStatus?>(null)
    val status: StateFlow<VaultStatus?> = _status.asStateFlow()

    suspend fun refresh(): VaultStatus? = withContext(io) {
        runCatching { vaultApi.status() }.getOrNull()?.also { _status.value = it }
    }

    suspend fun unlock(password: String): Result<VaultStatus> = withContext(io) {
        runCatching { vaultApi.unlock(password) }.onSuccess { _status.value = it }
    }

    suspend fun lock(): Result<VaultStatus> = withContext(io) {
        runCatching { vaultApi.lock() }.onSuccess { _status.value = it }
    }

    suspend fun setHidePrivate(hidePrivate: Boolean): Result<VaultStatus> = withContext(io) {
        runCatching { vaultApi.setHidePrivate(hidePrivate) }.onSuccess { _status.value = it }
    }
}
