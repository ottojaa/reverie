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
 * Private-folder locks. A successful unlock is recorded server-side in the httpOnly
 * `vault_session` session cookie, which the shared [SessionCookieStorage] replays on every later
 * request; the client keeps no unlock state of its own. There is deliberately no lock call — the
 * app can only open locks, and logout closes them all.
 */
@Singleton
class VaultApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun status(): VaultStatus = client.get("vault/status").decode()

    suspend fun unlock(folderId: String, password: String): VaultStatus =
        client.post("vault/unlock") {
            contentType(ContentType.Application.Json)
            setBody(VaultUnlockRequest(password = password, folder_id = folderId))
        }.decode()
}
