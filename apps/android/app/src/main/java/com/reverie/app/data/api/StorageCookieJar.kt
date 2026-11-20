package com.reverie.app.data.api

import io.ktor.http.CookieEncoding
import io.ktor.http.Url
import io.ktor.http.encodeCookieValue
import kotlinx.coroutines.runBlocking
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * Lets an OkHttp client (Coil thumbnails, Media3 video) share the Ktor client's cookie store.
 * OkHttp calls the jar on its own dispatcher threads, so the suspending store is bridged with
 * [runBlocking] — the same pattern the image authenticator already uses for token refresh.
 */
class StorageCookieJar(private val storage: SessionCookieStorage) : CookieJar {

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val cookies = runBlocking { storage.get(Url(url.toString())) }
        return cookies.mapNotNull { it.toOkHttpCookie(url.host) }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val requestUrl = Url(url.toString())
        runBlocking { cookies.forEach { storage.addCookie(requestUrl, it.toKtorCookie()) } }
    }
}

/**
 * Convert a stored Ktor cookie to OkHttp's type for a request to [host]. Returns null when the
 * cookie can't be represented (OkHttp rejects blank or malformed names/values).
 */
fun io.ktor.http.Cookie.toOkHttpCookie(host: String): Cookie? {
    val builder = Cookie.Builder()
        .name(name)
        // OkHttp writes the value verbatim into the Cookie header, so hand it the wire form.
        .value(encodeCookieValue(value, encoding))
        .hostOnlyDomain(host)
        .path(path ?: "/")
    expires?.let { builder.expiresAt(it.timestamp) }
    if (secure) builder.secure()
    if (httpOnly) builder.httpOnly()
    return runCatching { builder.build() }.getOrNull()
}

/** Convert an OkHttp cookie from a response into the Ktor type kept in the shared store. */
fun Cookie.toKtorCookie(): io.ktor.http.Cookie = io.ktor.http.Cookie(
    name = name,
    value = value,
    // OkHttp hands over the raw wire value; keep it raw so Ktor doesn't re-encode it on send.
    encoding = CookieEncoding.RAW,
    expires = if (persistent) io.ktor.util.date.GMTDate(expiresAt) else null,
    domain = domain,
    path = path,
    secure = secure,
    httpOnly = httpOnly,
)
