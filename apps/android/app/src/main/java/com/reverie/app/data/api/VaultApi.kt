package com.reverie.app.data.api

import com.reverie.app.data.api.model.VaultSettingsRequest
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.data.api.model.VaultUnlockRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The vault unlock session is returned only as an httpOnly cookie, which the client's
 * in-memory cookie jar carries on subsequent requests — no extra handling needed here.
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

    suspend fun setHidePrivate(hidePrivate: Boolean): VaultStatus = client.patch("vault/settings") {
        contentType(ContentType.Application.Json)
        setBody(VaultSettingsRequest(hidePrivate))
    }.decode()
}
