package com.reverie.app.data.api

import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.data.api.model.VaultUnlockRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The vault unlock session is returned only as an httpOnly session cookie, which the client's
 * in-memory cookie jar carries on subsequent requests — no extra handling needed here. It has no
 * timeout; it lasts until the process dies, logout clears the jar, or an explicit lock.
 */
@Singleton
class VaultApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun status(): VaultStatus = client.get("vault/status").decode()

    suspend fun unlock(password: String): VaultStatus = client.post("vault/unlock") {
        contentType(ContentType.Application.Json)
        setBody(VaultUnlockRequest(password))
    }.decode()

    suspend fun lock(): VaultStatus = client.post("vault/lock").decode()
}
