package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A "too many requests" from the server ends the pass without holding it against any file, and backup waits. */
class BackupRateLimitTest : ParallelUploadHarness() {
    private fun tooMany(retryAfter: Long? = 600) =
        ReverieApiException.Http(429, "TOO_MANY_REQUESTS", "Rate limit exceeded", retryAfterSeconds = retryAfter)

    /** Uploads of 4 and up are refused; 4 hears of it first, while 5 and 6 are still going up. */
    private fun TestScope.refuseFromFour(retryAfter: Long? = 600) =
        uploadsTake(lasting = { if (it == 4L) 500 else 1_000 }) { if (it >= 4) throw tooMany(retryAfter) }

    private fun waitLeft(result: PassResult) = (result.end as PassEnd.Stopped).retryAfterMs

    @Test fun `a 429 mid-group starts no more uploads and fails no file`() = runTest {
        refuseFromFour()

        val result = runner(photos(30)).run(request())

        assertTrue("$result", result.end is PassEnd.Stopped)
        assertEquals((1L..6L).toSet(), startedAt.keys)
        assertEquals("those in flight finished", setOf(1L, 2L, 3L), dao.ledger.value.keys)
        assertTrue(dao.retryRows.value.isEmpty())
        assertEquals(0, result.failed)
        assertNull(result.firstFailure)
    }

    @Test fun `those still in flight when the 429 arrives finish and are recorded`() = runTest {
        uploadsTake(lasting = { if (it == 1L) 500 else 2_000 }) { if (it == 1L) throw tooMany() }

        val result = runner(photos(6)).run(request())

        assertEquals(setOf(2L, 3L), dao.ledger.value.keys)
        assertEquals(2, result.uploaded)
        assertEquals(setOf(1L, 2L, 3L), startedAt.keys)
    }

    @Test fun `no pass asks the server anything before Retry-After is over, not even Back up now`() = runTest {
        refuseFromFour(retryAfter = 600)
        val runner = runner(photos(8))
        val first = runner.run(request())
        // The last refusals arrived at 2 s.
        assertEquals(600_000L, waitLeft(first))
        transport.hashed.clear()
        transport.checked.clear()
        startedAt.clear()
        uploadsTake()

        advanceTimeBy(599_000)
        val early = runner.run(request())
        val asked = runner.run(request().copy(userInitiated = true))

        assertEquals(1_000L, waitLeft(early))
        assertEquals(1_000L, waitLeft(asked))
        assertTrue(transport.hashed.isEmpty() && transport.checked.isEmpty() && startedAt.isEmpty())

        advanceTimeBy(1_000)
        val onTime = runner.run(request())

        assertEquals(PassEnd.Completed, onTime.end)
        assertEquals("the refused files were not held back", (1L..8L).toSet(), dao.ledger.value.keys)
    }

    @Test fun `the wait outlives the process`() = runTest {
        refuseFromFour(retryAfter = 600)
        runner(photos(8)).run(request())

        val stored = settings.current().serverWait

        assertEquals(ServerWait(since = 2_000, lengthMs = 600_000), stored)
    }

    @Test fun `a 429 without Retry-After waits as long as the upload window`() = runTest {
        refuseFromFour(retryAfter = null)

        val result = runner(photos(8)).run(request())

        assertEquals(UPLOAD_WINDOW_MS, waitLeft(result))
    }

    @Test fun `a very short Retry-After still waits a minute`() = runTest {
        refuseFromFour(retryAfter = 0)

        val result = runner(photos(8)).run(request())

        assertEquals(60_000L, waitLeft(result))
    }

    @Test fun `a 429 that arrives after another failure ended the pass is still honoured`() = runTest {
        uploadsTake(lasting = { if (it == 1L) 500 else 1_000 }) {
            if (it == 1L) throw ReverieApiException.Network(RuntimeException("offline"))
            throw tooMany(retryAfter = 120)
        }

        val result = runner(photos(5)).run(request())

        assertEquals(120_000L, waitLeft(result))
    }

    @Test fun `a 429 on the content check waits too`() = runTest {
        transport.checkFailure = tooMany(retryAfter = 120)

        val result = runner(photos(3)).run(request())

        assertEquals(120_000L, waitLeft(result))
        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `a 429 on making an album's folder waits too`() = runTest {
        transport.beforeCreate = { throw tooMany(retryAfter = 120) }

        val result = runner(photos(3)).run(request())

        assertEquals(120_000L, waitLeft(result))
        assertTrue(transport.checked.isEmpty())
        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `a failure that is not a 429 asks for no wait`() = runTest {
        transport.checkFailure = ReverieApiException.Http(500, "error", "Broken")
        val runner = runner(photos(3))

        val result = runner.run(request())

        assertNull(waitLeft(result))
        assertNull(settings.current().serverWait)
    }

    @Test fun `a wait ends on time, and doesn't hold once the clock is set back`() {
        val wait = ServerWait(since = 10_000, lengthMs = 5_000)

        assertEquals(5_000, wait.left(10_000))
        assertEquals(1, wait.left(14_999))
        assertEquals(0, wait.left(15_000))
        assertEquals("the clock went back", 0, wait.left(9_999))
    }

    @Test fun `switching library drops the wait another one asked for`() = runTest {
        runner(photos(1))
        settings.setServerWait(ServerWait(since = 0, lengthMs = 60_000))

        settings.setLibraryKey("https://other.example|user")

        assertNull(settings.current().serverWait)
    }
}
