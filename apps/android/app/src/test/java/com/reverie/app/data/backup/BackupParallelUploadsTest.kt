package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.local.entity.BackupLedgerEntity
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class BackupParallelUploadsTest : ParallelUploadHarness() {
    @Test fun `three files upload at once and never more`() = runTest {
        uploadsTake()

        val result = runner(photos(7)).run(request())

        assertEquals(PassEnd.Completed, result.end)
        assertEquals(3, peak)
        assertEquals(7, result.uploaded)
        assertEquals((1L..7L).toSet(), dao.ledger.value.keys)
        assertEquals("three rounds of one second", 3_000, testScheduler.currentTime)
    }

    @Test fun `the request sets how many upload at once, from one to three`() = runTest {
        for ((asked, expected) in listOf(0 to 1, 1 to 1, 2 to 2, 9 to 3)) {
            dao.clearAll()
            peak = 0
            uploadsTake()

            runner(photos(7)).run(request(parallelUploads = asked))

            assertEquals("asked for $asked", expected, peak)
        }
    }

    @Test fun `a slow upload does not hold the others back`() = runTest {
        uploadsTake(lasting = { if (it == 1L) 100_000 else 1_000 })

        runner(photos(7)).run(request())

        assertEquals(listOf(2L, 3L, 4L, 5L, 6L, 7L, 1L), transport.uploaded)
        assertEquals(100_000, testScheduler.currentTime)
    }

    @Test fun `the next group waits for the one before it`() = runTest {
        uploadsTake(lasting = { if (it == 25L) 10_000 else 1_000 })

        runner(photos(27)).run(request())

        assertEquals(listOf(25, 2), transport.checked.map { it.size })
        assertEquals(0, startedBeside[26])
    }

    @Test fun `identical files go up once, never side by side`() = runTest {
        uploadsTake()

        val result = runner(photos(2), twins()).run(request())

        assertEquals(listOf(1L), transport.uploaded)
        assertEquals(1, peak)
        assertEquals(1, result.skipped)
        assertEquals(BackupLedgerEntity.OUTCOME_SKIPPED, dao.ledger.value.getValue(2).outcome)
    }

    @Test fun `an identical file uploads itself after the first copy fails`() = runTest {
        uploadsTake { if (it == 1L) throw ReverieApiException.Http(400, "bad", "Bad file") }

        val result = runner(photos(3), twins()).run(request())

        assertEquals(setOf(2L, 3L), transport.uploaded.toSet())
        assertEquals("it waited for the first copy", 1_000L, startedAt[2])
        assertEquals(1, result.failed)
    }

    @Test fun `while a manual upload runs, backup goes one at a time`() = runTest {
        manualUploadRunning = true
        uploadsTake()

        val result = runner(photos(5)).run(request())

        assertEquals(1, peak)
        assertEquals(5, result.uploaded)
    }

    @Test fun `a manual upload starting mid-group stops new uploads until those in flight have ended`() = runTest {
        // 1 to 3 are in flight when the manual upload starts; it ends while 6 is uploading.
        uploadsTake(lasting = { mapOf(1L to 3_000L, 3L to 2_000L)[it] ?: 1_000L })
        val take = transport.onUpload
        transport.onUpload = {
            if (it.id == 3L) manualUploadRunning = true
            if (it.id == 6L) manualUploadRunning = false
            take(it)
        }

        val result = runner(photos(10)).run(request())

        assertEquals(10, result.uploaded)
        assertEquals("4 waits for all three", 3_000L, startedAt[4])
        assertEquals(listOf(0, 0, 0), listOf(4L, 5L, 6L).map { startedBeside[it] })
        assertEquals("side by side again", 2, startedBeside[9])
    }

    @Test fun `a manual upload that starts while backup waits for the request budget is still made way for`() = runTest {
        uploadsTake { if (it == 1L) manualUploadRunning = true }

        runner(photos(6), budget = UploadBudget(limit = 3, windowMs = 10_000)).run(request())

        assertEquals(listOf(0, 0, 0), listOf(4L, 5L, 6L).map { startedBeside[it] })
    }

    @Test fun `a folder that refuses several uploads in flight holds back its album and no other`() = runTest {
        val source = FakeSource(listOf(media(1), media(2), media(3, bucket = 2), media(4), media(5)))
        val runner = runner(source)
        val photos = transport.server.add("Photos")
        settings.setBuckets(setOf(1L, 2L))
        settings.chooseAlbumFolder(1, photos, "Photos")
        uploadsTake { transport.server.locked += photos }

        val result = runner.run(request().copy(config = BackupConfig(setOf(1L, 2L), INCLUDE_EXISTING)))

        assertEquals(PassEnd.Completed, result.end)
        assertEquals("those in flight were tried, the rest were not", setOf(1L, 2L, 3L), startedAt.keys)
        assertEquals(setOf(3L), dao.ledger.value.keys)
        assertEquals(0, result.failed)
        assertEquals(AlbumProblem.Locked, settings.current().albumProblem(1))
    }

    @Test fun `uploads that all find their folder gone end up in the one made in its place`() = runTest {
        val source = photos(1)
        uploadsTake()
        val runner = runner(source)
        runner.run(request())
        val first = settings.current().albumFolder(1)!!.folderId
        transport.server.delete(first)
        source.items = listOf(media(2), media(3), media(4))

        val result = runner.run(request())

        assertEquals(PassEnd.Completed, result.end)
        assertEquals(3, peak)
        assertEquals(List(3) { "Phone backup/Camera" }, listOf(2L, 3L, 4L).map { transport.uploadedTo[it] })
        assertNotEquals(first, settings.current().albumFolder(1)!!.folderId)
        val backup = transport.server.children(null).single()
        assertEquals(1, transport.server.children(backup.id).size)
    }
}
