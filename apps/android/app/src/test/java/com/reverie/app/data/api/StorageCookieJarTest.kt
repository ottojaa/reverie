package com.reverie.app.data.api

import io.ktor.http.CookieEncoding
import io.ktor.http.Url
import kotlinx.coroutines.test.runTest
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StorageCookieJarTest {

    private val server = "https://reverie.example/"
    private val url = server.toHttpUrl()

    private fun sessionCookie(): Cookie =
        Cookie.Builder().name("vault_session").value("abc123").domain("reverie.example").path("/").httpOnly().build()

    @Test fun `a cookie set on an OkHttp response is visible to the Ktor client`() = runTest {
        val storage = SessionCookieStorage()
        StorageCookieJar(storage).saveFromResponse(url, listOf(sessionCookie()))

        val seenByKtor = storage.get(Url(server))

        assertEquals(listOf("vault_session"), seenByKtor.map { it.name })
        assertEquals("abc123", seenByKtor.single().value)
    }

    @Test fun `a cookie the Ktor client stored is sent by OkHttp`() = runTest {
        val storage = SessionCookieStorage()
        storage.addCookie(
            Url(server),
            io.ktor.http.Cookie("vault_session", "xyz", CookieEncoding.RAW, path = "/", httpOnly = true),
        )

        val sent = StorageCookieJar(storage).loadForRequest(url)

        assertEquals("xyz", sent.single { it.name == "vault_session" }.value)
    }

    @Test fun `a session cookie without an expiry stays a session cookie`() {
        val ktor = sessionCookie().toKtorCookie()

        assertNull(ktor.expires)
        assertTrue(ktor.httpOnly)
        assertNotNull(ktor.toOkHttpCookie("reverie.example"))
        assertEquals(false, ktor.toOkHttpCookie("reverie.example")!!.persistent)
    }

    @Test fun `clearing the storage forgets every cookie on both sides`() = runTest {
        val storage = SessionCookieStorage()
        val jar = StorageCookieJar(storage)
        jar.saveFromResponse(url, listOf(sessionCookie()))

        storage.clear()

        assertTrue(storage.get(Url(server)).isEmpty())
        assertTrue(jar.loadForRequest(url).isEmpty())
    }
}
