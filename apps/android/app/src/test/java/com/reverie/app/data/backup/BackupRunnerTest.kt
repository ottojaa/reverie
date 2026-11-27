package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.ContentLocation
import com.reverie.app.data.api.model.FolderContent
import com.reverie.app.data.api.model.PrivateContent
import com.reverie.app.data.api.model.TrashContent
import com.reverie.app.data.local.entity.BackupLedgerEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class BackupRunnerTest {
    @get:Rule
    val files = TemporaryFolder()

    private val minute = 60_000L
    private var clock = 1_000_000L

    private val dao = FakeDao()
    private val transport = FakeTransport { clock += it }

    private lateinit var settings: BackupSettingsRepository

    private fun TestScope.runner(vararg items: BackupMedia) = runner(FakeSource(items.toList()))

    private fun TestScope.runner(source: BackupMediaSource, over: BackupTransport = transport): BackupRunner {
        settings = settingsRepository(files)
        return BackupRunner(source, over, dao, BackupFolders(settings, over), settings) { clock }
    }

    private fun request(
        budgetMs: Long = 8 * minute,
        userInitiated: Boolean = false,
        includeParked: Boolean = false,
        timedOut: Boolean = false,
        buckets: Set<Long> = setOf(1),
        addedAfter: Long = INCLUDE_EXISTING,
        parallelUploads: Int = MAX_PARALLEL_UPLOADS,
    ) = BackupRequest(
        BackupConfig(buckets, addedAfter), budgetMs, userInitiated, includeParked, parallelUploads = parallelUploads,
    ) { timedOut }

    @Test fun `a new file is uploaded into its album's folder and ledgered`() = runTest {
        val result = runner(media(1)).run(request())

        assertEquals(PassEnd.Completed, result.end)
        assertEquals(listOf(1L), transport.uploaded)
        assertEquals("Phone backup/Camera", transport.uploadedTo[1])
        val row = dao.ledger.value.getValue(1)
        assertEquals(BackupLedgerEntity.OUTCOME_UPLOADED, row.outcome)
        assertEquals("doc-1", row.documentId)
        assertEquals("h1", row.sha256)
    }

    @Test fun `content in a folder, a private folder or the trash is skipped and never uploaded`() = runTest {
        transport.known["h1"] = FolderContent(listOf("Trips"), "a.jpg")
        transport.known["h2"] = PrivateContent
        transport.known["h3"] = TrashContent

        val result = runner(media(1), media(2), media(3), media(4)).run(request())

        assertEquals(listOf(4L), transport.uploaded)
        assertEquals(3, result.skipped)
        assertEquals(1, result.uploaded)
        listOf(1L, 2L, 3L).forEach { id ->
            val row = dao.ledger.value.getValue(id)
            assertEquals(BackupLedgerEntity.OUTCOME_SKIPPED, row.outcome)
            assertNull(row.documentId)
        }
    }

    @Test fun `a second pass has nothing to do once everything is in the ledger`() = runTest {
        val runner = runner(media(1), media(2))
        runner.run(request())
        transport.uploaded.clear()

        val result = runner.run(request())

        assertEquals(PassEnd.Completed, result.end)
        assertEquals(emptyList<Long>(), transport.uploaded)
    }

    @Test fun `only files in the selected albums are touched`() = runTest {
        runner(media(1, bucket = 1), media(2, bucket = 9)).run(request())

        assertEquals(listOf(1L), transport.uploaded)
        assertTrue(2L !in dao.ledger.value)
    }

    @Test fun `files are checked in groups of 25`() = runTest {
        runner(*Array(30) { media(it + 1L) }).run(request())

        assertEquals(listOf(25, 5), transport.checked.map { it.size })
    }

    @Test fun `a failed upload is retried on a later pass, not in the same pass and not before its backoff`() = runTest {
        var failures = 0
        transport.onUpload = { if (it.id == 1L && failures++ == 0) throw ReverieApiException.Http(400, "bad", "Bad file") }
        val runner = runner(media(1), media(2))

        val first = runner.run(request())

        assertEquals(1, failures)
        assertEquals(1, first.failed)
        assertEquals("Bad file", first.firstFailure)
        assertEquals(listOf(2L), transport.uploaded)
        assertTrue(1L !in dao.ledger.value)
        val retry = dao.retryRows.value.getValue(1)
        assertEquals(1, retry.failures)
        assertEquals(clock + 30 * minute, retry.nextAttemptAt)

        runner.run(request())
        assertEquals("still backing off", 1, failures)

        clock += 31 * minute
        val later = runner.run(request())

        assertEquals(PassEnd.Completed, later.end)
        assertEquals(listOf(2L, 1L), transport.uploaded)
        assertEquals(BackupLedgerEntity.OUTCOME_UPLOADED, dao.ledger.value.getValue(1).outcome)
        assertNull("retry row is dropped once the file is ledgered", dao.retryRows.value[1])
    }

    @Test fun `Back up now tries a failed file again without waiting for its backoff`() = runTest {
        var failures = 0
        transport.onUpload = { if (failures++ == 0) throw ReverieApiException.Http(413, "too_large", "Too large") }
        val runner = runner(media(1))
        runner.run(request())

        runner.run(request(userInitiated = true))

        assertEquals(2, failures)
        assertEquals(BackupLedgerEntity.OUTCOME_UPLOADED, dao.ledger.value.getValue(1).outcome)
    }

    @Test fun `the slice stops when its time is up and the next pass resumes from the ledger`() = runTest {
        transport.uploadCost = 400
        val runner = runner(*Array(5) { media(it + 1L) })

        val first = runner.run(request(budgetMs = 1_000))

        assertEquals(PassEnd.OutOfTime, first.end)
        assertEquals(listOf(1L, 2L, 3L), transport.uploaded)
        assertEquals(setOf(1L, 2L, 3L), dao.ledger.value.keys)

        val second = runner.run(request(budgetMs = 1_000))

        assertEquals(PassEnd.Completed, second.end)
        assertEquals(listOf(1L, 2L, 3L, 4L, 5L), transport.uploaded)
    }

    @Test fun `identical bytes under two ids upload once and the copy is recorded as skipped`() = runTest {
        val twin = object : BackupTransport by transport {
            override suspend fun hash(media: BackupMedia): String? = "same"
        }

        val result = runner(FakeSource(listOf(media(1), media(2))), twin).run(request())

        assertEquals(listOf(1L), transport.uploaded)
        assertEquals(1, result.uploaded)
        assertEquals(1, result.skipped)
        assertEquals(BackupLedgerEntity.OUTCOME_SKIPPED, dao.ledger.value.getValue(2).outcome)
    }

    @Test fun `a failing content check ends the pass and nothing is uploaded unchecked`() = runTest {
        transport.checkFailure = ReverieApiException.Network(RuntimeException("offline"))

        val result = runner(media(1)).run(request())

        assertTrue(result.end is PassEnd.Stopped)
        assertEquals(emptyList<Long>(), transport.uploaded)
        assertTrue(dao.ledger.value.isEmpty())
    }

    @Test fun `a short content-check answer ends the pass instead of uploading unmatched files`() = runTest {
        transport.shortAnswer = true

        val result = runner(media(1), media(2)).run(request())

        assertTrue(result.end is PassEnd.Stopped)
        assertEquals(emptyList<Long>(), transport.uploaded)
    }

    @Test fun `losing the session during an upload ends the pass without counting the file as failed`() = runTest {
        transport.onUpload = { throw ReverieApiException.Http(401, "unauthorized", "Unauthorized") }

        val result = runner(media(1), media(2)).run(request())

        val end = result.end as PassEnd.Stopped
        assertTrue(end.error.contains("signed out"))
        assertEquals(0, result.failed)
        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `each album uploads into a folder of its own`() = runTest {
        runner(media(1, bucket = 1), media(2, bucket = 2), media(3, bucket = 1)).run(request(buckets = setOf(1, 2)))

        assertEquals(
            mapOf(1L to "Phone backup/Camera", 2L to "Phone backup/Album 2", 3L to "Phone backup/Camera"),
            transport.uploadedTo,
        )
        assertEquals("the backup folder and one per album", 3, transport.server.creates)
    }

    @Test fun `only new leaves what was there alone, unledgered, until existing media is included`() = runTest {
        val runner = runner(media(1, addedAt = 99), media(2, addedAt = 100))

        runner.run(request(addedAfter = 100))

        assertEquals(listOf(2L), transport.uploaded)
        assertTrue(1L !in dao.ledger.value)

        runner.run(request(addedAfter = INCLUDE_EXISTING))

        assertEquals(listOf(2L, 1L), transport.uploaded)
    }

    @Test fun `a ticked album gets its folder before it has anything to upload, an unticked one none`() = runTest {
        runner(media(1, addedAt = 1), media(2, bucket = 9, addedAt = 1)).run(request(addedAfter = 100))

        val backup = transport.server.children(null).single()
        assertEquals("Phone backup", backup.name)
        assertEquals(listOf("Camera"), transport.server.children(backup.id).map { it.name })
        assertEquals(emptyList<Long>(), transport.uploaded)
    }

    @Test fun `an album folder that is gone is made again and the file goes into the new one`() = runTest {
        val source = FakeSource(listOf(media(1)))
        val runner = runner(source)
        runner.run(request())
        val first = settings.current().albumFolder(1)!!.folderId
        transport.server.delete(first)
        source.items = listOf(media(2), media(1))

        val result = runner.run(request())

        assertEquals(PassEnd.Completed, result.end)
        assertEquals("Phone backup/Camera", transport.uploadedTo[2])
        assertNotEquals(first, settings.current().albumFolder(1)!!.folderId)
        assertNull(settings.current().folderNotice)
    }

    @Test fun `a backup folder that is gone is made again and the status says so`() = runTest {
        val source = FakeSource(listOf(media(1)))
        val runner = runner(source)
        runner.run(request())
        val first = settings.current().folderId!!
        transport.server.delete(first)
        source.items = listOf(media(2), media(1))

        val result = runner.run(request())

        assertEquals(PassEnd.Completed, result.end)
        assertEquals("Phone backup/Camera", transport.uploadedTo[2])
        assertNotEquals(first, settings.current().folderId)
        assertEquals("The “Phone backup” folder was gone, so it was made again.", settings.current().folderNotice)
    }

    @Test fun `a folder that is still not found after being made again ends the pass`() = runTest {
        var attempts = 0
        transport.onUpload = {
            attempts++
            throw notFound()
        }

        val result = runner(media(1), media(2)).run(request(parallelUploads = 1))

        assertEquals(2, attempts)
        assertTrue((result.end as PassEnd.Stopped).error.contains("couldn't be found"))
        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `a folder name the server refuses fails that album's files and the others go up`() = runTest {
        transport.beforeCreate = { if (it == "Camera") throw ReverieApiException.Http(400, "bad", "Bad name") }

        val result = runner(media(1), media(2, bucket = 2)).run(request(buckets = setOf(1, 2)))

        assertEquals(PassEnd.Completed, result.end)
        assertEquals(listOf(2L), transport.uploaded)
        assertEquals(1, result.failed)
        assertEquals("Bad name", result.firstFailure)
    }

    @Test fun `losing the network while making folders ends the pass before anything is checked`() = runTest {
        transport.beforeCreate = { throw ReverieApiException.Network(RuntimeException("offline")) }

        val result = runner(media(1)).run(request())

        assertTrue(result.end is PassEnd.Stopped)
        assertTrue(transport.checked.isEmpty())
        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `a file cut off by the time limit goes first next time and is parked when cut off alone again`() = runTest {
        var cut = true
        transport.onUpload = { if (it.id == 1L && cut) throw CancellationException("stopped") }
        val runner = runner(media(1), media(2))

        assertCancelled { runner.run(request(timedOut = true)) }
        assertEquals(CUT_OFF_PRIORITY, dao.retryRows.value.getValue(1).cutOffs)

        assertCancelled { runner.run(request(timedOut = true)) }
        assertEquals("it was first in line and alone", CUT_OFF_PARKED, dao.retryRows.value.getValue(1).cutOffs)

        // Parked: a background pass leaves it out and carries on with the rest.
        val background = runner.run(request())
        assertEquals(PassEnd.Completed, background.end)
        assertEquals(listOf(2L), transport.uploaded)

        // A run that is allowed to include parked files finishes it.
        cut = false
        val foreground = runner.run(request(userInitiated = true, includeParked = true))
        assertEquals(PassEnd.Completed, foreground.end)
        assertEquals(listOf(2L, 1L), transport.uploaded)
        assertNull(dao.retryRows.value[1])
    }

    @Test fun `a stop that is not a timeout leaves the file alone`() = runTest {
        transport.onUpload = { throw CancellationException("network lost") }

        assertCancelled { runner(media(1)).run(request(timedOut = false)) }

        assertTrue(dao.retryRows.value.isEmpty())
    }

    @Test fun `a second background pass does nothing while one is running`() = runTest {
        val gate = CompletableDeferred<Unit>()
        transport.onUpload = { gate.await() }
        val runner = runner(media(1))

        val first = async { runner.run(request()) }
        advanceUntilIdle()
        val second = runner.run(request())

        assertEquals(PassEnd.Busy, second.end)
        gate.complete(Unit)
        assertEquals(PassEnd.Completed, first.await().end)
        assertEquals(listOf(1L), transport.uploaded)
    }

    @Test fun `a pass the user started waits for the running one and then runs`() = runTest {
        val gate = CompletableDeferred<Unit>()
        transport.onUpload = { if (it.id == 1L) gate.await() }
        val runner = runner(media(1))

        val first = async { runner.run(request()) }
        advanceUntilIdle()
        val manual = async { runner.run(request(userInitiated = true)) }
        runCurrent() // not advanceUntilIdle: that would jump virtual time past the 5-minute wait
        gate.complete(Unit)

        assertEquals(PassEnd.Completed, first.await().end)
        assertEquals(PassEnd.Completed, manual.await().end)
        assertEquals("the file went up once", listOf(1L), transport.uploaded)
    }

    private suspend fun assertCancelled(block: suspend () -> Unit) {
        try {
            block()
        } catch (_: CancellationException) {
            return
        }
        fail("expected the pass to be cancelled")
    }
}
