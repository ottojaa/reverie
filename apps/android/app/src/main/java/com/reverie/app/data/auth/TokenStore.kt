package com.reverie.app.data.auth

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.model.UserDto
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

private val Context.tokenDataStore: DataStore<Preferences> by preferencesDataStore(name = "reverie_tokens")

/**
 * The persisted session: access token, the rotating refresh token, access expiry, and a
 * cached user so an offline cold-start can still show the signed-in UI.
 */
@Serializable
data class TokenBundle(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtEpochMs: Long,
    val user: UserDto,
)

/** Persistence boundary for the session — an interface so the session logic is testable. */
interface TokenStore {
    suspend fun load(): TokenBundle?
    suspend fun save(bundle: TokenBundle)
    suspend fun clear()
}

/**
 * Persists the [TokenBundle] as a single Keystore-encrypted blob in DataStore. Survives
 * process death so the app can silently refresh on next launch.
 */
@Singleton
class EncryptedTokenStore @Inject constructor(
    @ApplicationContext private val context: Context,
    private val crypto: CryptoManager,
) : TokenStore {
    private val blobKey = stringPreferencesKey("session_blob")

    override suspend fun load(): TokenBundle? {
        val encoded = context.tokenDataStore.data.firstOrNull()?.get(blobKey) ?: return null
        val json = crypto.decrypt(encoded) ?: return null
        return runCatching { ApiJson.decodeFromString(TokenBundle.serializer(), json) }.getOrNull()
    }

    override suspend fun save(bundle: TokenBundle) {
        val encrypted = crypto.encrypt(ApiJson.encodeToString(TokenBundle.serializer(), bundle))
        context.tokenDataStore.edit { it[blobKey] = encrypted }
    }

    override suspend fun clear() {
        context.tokenDataStore.edit { it.remove(blobKey) }
    }
}
