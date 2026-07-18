package com.reverie.app.data.api

import io.ktor.client.call.body
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.http.parseServerSetCookieHeader

/**
 * Decode a successful response body, or throw a typed [ReverieApiException] parsed from the
 * error envelope. The client runs with `expectSuccess = false` so error bodies are readable.
 */
suspend inline fun <reified T> HttpResponse.decode(): T {
    if (!status.isSuccess()) {
        throw ReverieApiException.parse(status.value, runCatching { bodyAsText() }.getOrDefault(""))
    }
    return try {
        body()
    } catch (e: ReverieApiException) {
        throw e
    } catch (e: Exception) {
        throw ReverieApiException.Serialization(e)
    }
}

/** Throw a typed error for a non-2xx response; used for endpoints with no body (204). */
suspend fun HttpResponse.throwIfError() {
    if (!status.isSuccess()) {
        throw ReverieApiException.parse(status.value, runCatching { bodyAsText() }.getOrDefault(""))
    }
}

/** Value of a `Set-Cookie` cookie by name, or null. Used to capture the rotating refresh token. */
fun HttpResponse.cookieValue(name: String): String? =
    headers.getAll(HttpHeaders.SetCookie).orEmpty()
        .map { parseServerSetCookieHeader(it) }
        .firstOrNull { it.name == name }
        ?.value
