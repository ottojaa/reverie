package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.FolderDto
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Passes over albums that have folders of their own, and over folders that take no uploads. */
class BackupAlbumFolderRunTest {
    @get:Rule
    val files = TemporaryFolder()

    private val dao = FakeDao()
    private val transport = FakeTransport()
    private val server = transport.server
    private val source = FakeSource(listOf(media(1), media(2, bucket = 2), media(3)))

    private lateinit var settings: BackupSettingsRepository

    /** A phone with the camera (album 1) and one other album, both ticked. */
    private suspend fun TestScope.runner(over: BackupTransport = transport): BackupRunner {
        settings = settingsRepository(files)
        settings.setBuckets(setOf(1L, 2L))
        return BackupRunner(source, over, dao, BackupFolders(settings, over), settings) { 0 }
    }

    private suspend fun BackupRunner.pass(seesAllMedia: Boolean = true, parallelUploads: Int = MAX_PARALLEL_UPLOADS) = run(
        BackupRequest(
            BackupConfig(setOf(1L, 2L), INCLUDE_EXISTING),
            budgetMs = 1_000,
            seesAllMedia = seesAllMedia,
            parallelUploads = parallelUploads,
        ),
    )

    private suspend fun choose(bucketId: Long, folderId: String) = settings.chooseAlbumFolder(bucketId, folderId, "Photos")

    private suspend fun problem(bucketId: Long) = settings.current().albumProblem(bucketId)

    /** The camera's two files wait, with nothing held against them; the other album's file went up. */
    private suspend fun assertOnlyCameraWaits(result: PassResult) {
        assertEquals(PassEnd.Completed, result.end)
        assertEquals(listOf(2L), transport.uploaded)
        assertEquals(setOf(2L), dao.ledger.value.keys)
        assertTrue(dao.retryRows.value.isEmpty())
        assertEquals(0, result.failed)
        assertNull(problem(2))
    }

    @Test fun `a chosen folder holds when the backup folder changes, until the album is reset`() = runTest {
        val runner = runner()
        choose(1, server.add("Photos"))
        runner.pass()
        assertEquals(mapOf(1L to "Photos", 2L to "Phone backup/Album 2", 3L to "Photos"), transport.uploadedTo)
        val backup = settings.current().folderId!!
        assertEquals("no subfolder for the camera", listOf("Album 2"), server.children(backup).map { it.name })
        settings.setDestination(server.add("Archive"), "Archive")
        source.items = listOf(media(4), media(5, bucket = 2))

        runner.pass()

        assertEquals("Photos", transport.uploadedTo[4])
        assertEquals("Archive/Album 2", transport.uploadedTo[5])

        settings.resetAlbumFolder(1)
        source.items = listOf(media(6))
        runner.pass()

        assertEquals("Archive/Camera", transport.uploadedTo[6])
        assertEquals("what is uploaded stays where it is", "Photos", transport.uploadedTo[4])
    }

    @Test fun `a chosen folder that is gone stops only its album and is not replaced`() = runTest {
        val runner = runner()
        val photos = server.add("Photos")
        choose(1, photos)
        server.delete(photos)

        assertOnlyCameraWaits(runner.pass())

        assertEquals(AlbumProblem.Gone, problem(1))
        assertEquals(photos, settings.current().albumFolder(1)?.folderId)
        assertEquals("nothing of the album is even read", listOf(2L), transport.hashed)
        assertNull(settings.current().folderNotice)
    }

    @Test fun `a locked chosen folder stops only its album`() = runTest {
        val runner = runner()
        val photos = server.add("Photos")
        choose(1, photos)
        server.locked += photos

        assertOnlyCameraWaits(runner.pass())

        assertEquals(AlbumProblem.Locked, problem(1))
        assertEquals(listOf(2L), transport.hashed)
    }

    @Test fun `a chosen folder inside a locked one stops only its album`() = runTest {
        val runner = runner()
        val vault = server.add("Vault")
        choose(1, server.add("Photos", vault))
        server.locked += vault

        assertOnlyCameraWaits(runner.pass())

        assertEquals(AlbumProblem.Locked, problem(1))
    }

    @Test fun `a problem shows with nothing left to upload`() = runTest {
        val runner = runner()
        val photos = server.add("Photos")
        choose(1, photos)
        runner.pass()
        server.delete(photos)

        runner.pass()

        assertEquals(AlbumProblem.Gone, problem(1))
    }

    @Test fun `a folder deleted during a pass holds back the rest of its album and no other`() = runTest {
        val runner = runner()
        val photos = server.add("Photos")
        choose(1, photos)
        var cameraAttempts = 0
        transport.onUpload = {
            if (it.bucketId == 1L) {
                cameraAttempts++
                server.delete(photos)
            }
        }

        assertOnlyCameraWaits(runner.pass(parallelUploads = 1))

        assertEquals("the second file isn't tried", 1, cameraAttempts)
        assertEquals(AlbumProblem.Gone, problem(1))
    }

    @Test fun `a subfolder locked during a pass holds back its album and is not made again`() = runTest {
        val runner = runner()
        var cameraAttempts = 0
        transport.onUpload = {
            if (it.bucketId == 1L) {
                cameraAttempts++
                server.locked += settings.current().albumFolder(1)!!.folderId
            }
        }

        assertOnlyCameraWaits(runner.pass(parallelUploads = 1))

        assertEquals(1, cameraAttempts)
        assertEquals(AlbumProblem.Locked, problem(1))
        assertEquals("the backup folder and one per album", 3, server.creates)
    }

    @Test fun `a locked backup folder stops the albums that need a subfolder of it, not one with its own folder`() = runTest {
        val runner = runner()
        val vault = server.add("Vault")
        server.locked += vault
        settings.setDestination(vault, "Vault")
        choose(2, server.add("Photos"))

        assertOnlyCameraWaits(runner.pass())

        assertEquals(AlbumProblem.Locked, problem(1))
        assertEquals("Photos", transport.uploadedTo[2])
    }

    @Test fun `a blocked album goes up once its folder takes uploads again`() = runTest {
        val runner = runner()
        val photos = server.add("Photos")
        choose(1, photos)
        server.locked += photos
        runner.pass()
        server.locked -= photos

        runner.pass()

        assertNull(problem(1))
        assertEquals(listOf(2L, 1L, 3L), transport.uploaded)
    }

    @Test fun `a locked backup folder that is unlocked again lets its albums through`() = runTest {
        val runner = runner()
        val vault = server.add("Vault")
        server.locked += vault
        settings.setDestination(vault, "Vault")
        runner.pass()
        server.locked -= vault

        runner.pass()

        assertNull(problem(1))
        assertNull(problem(2))
        assertEquals("Vault/Camera", transport.uploadedTo[1])
    }

    @Test fun `choosing another folder gets a blocked album going`() = runTest {
        val runner = runner()
        choose(1, "deleted")
        runner.pass()
        choose(1, server.add("Photos"))
        assertNull("the old problem isn't the new folder's", problem(1))

        runner.pass()

        assertEquals("Photos", transport.uploadedTo[1])
    }

    @Test fun `an album that left the phone loses its problem, unless the pass sees only some media`() = runTest {
        val runner = runner()
        choose(1, "deleted")
        runner.pass()
        source.items = listOf(media(2, bucket = 2))

        runner.pass(seesAllMedia = false)
        assertEquals(AlbumProblem.Gone, problem(1))

        runner.pass()
        assertNull(problem(1))
        assertEquals("deleted", settings.current().albumFolder(1)?.folderId)
    }

    @Test fun `a pass counts the phone's albums as known only when it sees all of them`() = runTest {
        val runner = runner()

        runner.pass(seesAllMedia = false)
        assertNull(settings.current().knownAlbums)

        runner.pass()
        assertEquals(setOf(1L, 2L), settings.current().knownAlbums)
    }

    @Test fun `losing the network while looking up a chosen folder ends the pass and blocks nothing`() = runTest {
        val offline = object : BackupTransport by transport {
            override suspend fun fetchFolder(folderId: String): FolderDto =
                throw ReverieApiException.Network(RuntimeException("offline"))
        }
        val runner = runner(offline)
        choose(1, server.add("Photos"))

        val result = runner.pass()

        assertTrue(result.end is PassEnd.Stopped)
        assertNull(problem(1))
        assertEquals(emptyList<Long>(), transport.uploaded)
    }
}
