package com.reverie.app.data.api

import com.reverie.app.data.api.model.LockSecret
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.data.api.model.VaultUnlockRequest
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
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

    /** Sets or changes the lock secret; a null [secret] removes it, so locks take the account password again. */
    suspend fun saveSecret(accountPassword: String, secret: LockSecret?): VaultStatus =
        client.put("vault/secret") {
            contentType(ContentType.Application.Json)
            // Built by hand: the server requires the `secret` key even when it is null, and ApiJson leaves nulls out.
            setBody(
                buildJsonObject {
                    put("account_password", accountPassword)
                    put("secret", secret?.let { ApiJson.encodeToJsonElement(it) } ?: JsonNull)
                },
            )
        }.decode()
}
