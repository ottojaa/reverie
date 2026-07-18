package com.reverie.app.data.api

import com.reverie.app.data.api.model.AuthErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiErrorTest {

    @Test fun `parses the auth error envelope`() {
        val e = ReverieApiException.parse(401, """{"error":"invalid_credentials","message":"Nope"}""")
        assertTrue(e is ReverieApiException.Auth)
        assertEquals(AuthErrorCode.INVALID_CREDENTIALS, (e as ReverieApiException.Auth).code)
        assertEquals("Invalid email or password.", e.userMessage())
    }

    @Test fun `parses the generic error envelope`() {
        val e = ReverieApiException.parse(409, """{"statusCode":409,"error":"CONFLICT","message":"Name taken"}""")
        assertTrue(e is ReverieApiException.Http)
        e as ReverieApiException.Http
        assertEquals(409, e.statusCode)
        assertEquals("Name taken", e.message)
    }

    @Test fun `treats an auth-looking error with a statusCode as generic`() {
        // The generic envelope also has an `error` field; the presence of statusCode disambiguates.
        val e = ReverieApiException.parse(401, """{"statusCode":401,"error":"invalid_credentials","message":"x"}""")
        assertTrue(e is ReverieApiException.Http)
    }

    @Test fun `falls back for non-json bodies`() {
        val e = ReverieApiException.parse(500, "<html>500</html>")
        assertTrue(e is ReverieApiException.Http)
        assertEquals(500, (e as ReverieApiException.Http).statusCode)
    }

    @Test fun `flags 401 and 403 as auth failures`() {
        assertTrue(ReverieApiException.isAuthFailure(ReverieApiException.Http(401, "x", "y")))
        assertTrue(ReverieApiException.isAuthFailure(ReverieApiException.Http(403, "x", "y")))
        assertTrue(!ReverieApiException.isAuthFailure(ReverieApiException.Http(404, "x", "y")))
    }
}
