package com.reverie.app.data.api

import io.ktor.client.plugins.cookies.AcceptAllCookiesStorage
import io.ktor.client.plugins.cookies.CookiesStorage
import io.ktor.http.Cookie
import io.ktor.http.Url
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The app's single cookie source: the Ktor [HttpCookies] plugin and the Coil/Media3 OkHttp client
 * (via [StorageCookieJar]) both read and write this one store, so the `vault_session` cookie that
 * records which private folders are open is sent on API calls AND on thumbnail/video requests.
 *
 * It lives in memory only. [clear] drops every cookie (refresh token and folder-lock session
 * alike) and is called on logout so the next sign-in starts with every private folder closed.
 */
@Singleton
class SessionCookieStorage @Inject constructor() : CookiesStorage {

    // AcceptAllCookiesStorage has no clear(); swapping in a fresh instance is the reset.
    @Volatile private var delegate = AcceptAllCookiesStorage()

    override suspend fun get(requestUrl: Url): List<Cookie> = delegate.get(requestUrl)

    override suspend fun addCookie(requestUrl: Url, cookie: Cookie) = delegate.addCookie(requestUrl, cookie)

    override fun close() = delegate.close()

    fun clear() {
        val old = delegate
        delegate = AcceptAllCookiesStorage()
        old.close()
    }
}
