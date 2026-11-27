package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** How a pass with several uploads in flight ends early. */
class BackupParallelStopTest : ParallelUploadHarness() {
    /** Runs a pass and stops it, as WorkManager would, [after] this much virtual time. */
    private suspend fun TestScope.stop(runner: BackupRunner, request: BackupRequest, after: Long = 500) {
        val pass = launch { runner.run(request) }
        advanceTimeBy(after)
        pass.cancelAndJoin()
    }

    private fun cutOffs() = dao.retryRows.value.mapValues { it.value.cutOffs }

    @Test fun `a timeout with three in flight sends all three to the front and parks none`() = runTest {
        uploadsTake(lasting = { 10_000 })
        val runner = runner(photos(4))

        stop(runner, request(timedOut = true))

        assertEquals(mapOf(1L to CUT_OFF_PRIORITY, 2L to CUT_OFF_PRIORITY, 3L to CUT_OFF_PRIORITY), cutOffs())
    }

    @Test fun `a file cut off before uploads alone, and only it is parked when cut off again`() = runTest {
        uploadsTake(lasting = { 10_000 })
        val runner = runner(photos(4))
        stop(runner, request(timedOut = true))

        stop(runner, request(timedOut = true))

        assertEquals(0, startedBeside[1])
        assertEquals(mapOf(1L to CUT_OFF_PARKED, 2L to CUT_OFF_PRIORITY, 3L to CUT_OFF_PRIORITY), cutOffs())
        startedBeside.clear()
        runner.run(request())
        assertEquals("each on its own, then the rest", listOf(0, 0, 0), listOf(2L, 3L, 4L).map { startedBeside[it] })
    }

    @Test fun `a stop that is not a timeout records nothing against any file in flight`() = runTest {
        uploadsTake(lasting = { 10_000 })

        stop(runner(photos(4)), request(timedOut = false))

        assertTrue(dao.retryRows.value.isEmpty())
        assertTrue(dao.ledger.value.isEmpty())
    }

    @Test fun `an identical file is not recorded as backed up when its copy is cut off`() = runTest {
        uploadsTake(lasting = { 10_000 })

        stop(runner(photos(2), twins()), request(timedOut = true))

        assertTrue(dao.ledger.value.isEmpty())
        assertEquals(mapOf(1L to CUT_OFF_PRIORITY), cutOffs())
    }

    @Test fun `losing the network in one upload lets the others finish and starts no more`() = runTest {
        uploadsTake(lasting = { if (it == 1L) 500 else 2_000 }) {
            if (it == 1L) throw ReverieApiException.Network(RuntimeException("offline"))
        }

        val result = runner(photos(6)).run(request(timedOut = true))

        assertTrue(result.end is PassEnd.Stopped)
        assertEquals(setOf(1L, 2L, 3L), startedAt.keys)
        assertEquals(setOf(2L, 3L), dao.ledger.value.keys)
        assertEquals(2, result.uploaded)
        assertTrue("nothing was cut off", dao.retryRows.value.isEmpty())
    }

    @Test fun `a folder never found, with several uploads in flight, ends the pass and fails no file`() = runTest {
        uploadsTake { throw ReverieApiException.Http(404, "not_found", "Not found") }

        val result = runner(photos(6)).run(request())

        assertTrue(result.end is PassEnd.Stopped)
        assertEquals(setOf(1L, 2L, 3L), startedAt.keys)
        assertTrue(dao.ledger.value.isEmpty())
        assertTrue(dao.retryRows.value.isEmpty())
        assertEquals(0, result.failed)
    }

    @Test fun `an unexpected error in one upload lets the others finish before it ends the pass`() = runTest {
        uploadsTake(lasting = { if (it == 1L) 500 else 2_000 }) { if (it == 1L) throw SecurityException("revoked") }
        val runner = runner(photos(6))

        try {
            runner.run(request(timedOut = true))
            fail("expected the error to come through")
        } catch (_: SecurityException) {
        }

        assertEquals(setOf(1L, 2L, 3L), startedAt.keys)
        assertEquals(setOf(2L, 3L), dao.ledger.value.keys)
        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `an upload cancelled on its own ends the pass after the others finish`() = runTest {
        uploadsTake(lasting = { if (it == 1L) 500 else 2_000 }) { if (it == 1L) throw CancellationException("stopped") }
        val runner = runner(photos(6))

        try {
            runner.run(request())
            fail("expected the pass to be cancelled")
        } catch (_: CancellationException) {
        }

        assertEquals(setOf(2L, 3L), dao.ledger.value.keys)
        assertEquals(setOf(1L, 2L, 3L), startedAt.keys)
    }

    @Test fun `when the time is up, uploads in flight finish and nothing more starts`() = runTest {
        uploadsTake()

        val result = runner(photos(7)).run(request(budgetMs = 1_500))

        assertEquals(PassEnd.OutOfTime, result.end)
        assertEquals((1L..6L).toSet(), dao.ledger.value.keys)
        assertEquals(2_000, testScheduler.currentTime)
    }

    @Test fun `an identical file whose first copy failed after the time was up waits for the next run`() = runTest {
        uploadsTake { if (it == 1L) throw ReverieApiException.Http(400, "bad", "Bad file") }

        val result = runner(photos(2), twins()).run(request(budgetMs = 500))

        assertEquals(PassEnd.OutOfTime, result.end)
        assertEquals(setOf(1L), startedAt.keys)
    }

    @Test fun `past the request budget the next upload waits for room`() = runTest {
        uploadsTake(lasting = { 100 })

        val result = runner(photos(5), budget = UploadBudget(limit = 2, windowMs = 10_000)).run(request())

        assertEquals(PassEnd.Completed, result.end)
        assertEquals(listOf(0L, 0L, 10_000L, 10_000L, 20_000L), (1L..5L).map { startedAt[it] })
    }

    @Test fun `the wait for room lasts no longer than the pass, and the next pass still honours it`() = runTest {
        uploadsTake(lasting = { 100 })
        val runner = runner(photos(5), budget = UploadBudget(limit = 2, windowMs = 10_000))

        val first = runner.run(request(budgetMs = 4_000))

        assertEquals(PassEnd.OutOfTime, first.end)
        assertEquals(setOf(1L, 2L), dao.ledger.value.keys)
        assertEquals(4_000, testScheduler.currentTime)

        runner.run(request(budgetMs = 8_000))
        assertEquals(10_000L, startedAt[3])
    }

    @Test fun `a stop during the wait for room is no cut-off`() = runTest {
        uploadsTake(lasting = { 100 })
        val runner = runner(photos(3), budget = UploadBudget(limit = 1, windowMs = 10_000))

        stop(runner, request(timedOut = true), after = 5_000)

        assertEquals(setOf(1L), dao.ledger.value.keys)
        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `an upload that ends the pass also ends the waits for room`() = runTest {
        uploadsTake(lasting = { 500 }) { if (it == 1L) throw ReverieApiException.Network(RuntimeException("offline")) }

        val result = runner(photos(5), budget = UploadBudget(limit = 2, windowMs = 60_000)).run(request())

        assertTrue(result.end is PassEnd.Stopped)
        assertEquals(setOf(1L, 2L), startedAt.keys)
        assertEquals(500, testScheduler.currentTime)
    }

    @Test fun `the budget forgets starts the window has passed, and ones from before the clock was set back`() {
        val budget = UploadBudget(limit = 2, windowMs = 1_000)
        assertEquals(0, budget.take(5_000))
        assertEquals(0, budget.take(5_400))

        assertEquals(500, budget.take(5_500))
        assertEquals(0, budget.take(6_000))
        assertEquals("the clock went back an hour", 0, budget.take(1_000))
    }
}
