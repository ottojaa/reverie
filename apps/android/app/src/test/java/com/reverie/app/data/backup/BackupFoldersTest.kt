package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.FolderDto
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class BackupFoldersTest {
    @get:Rule
    val files = TemporaryFolder()

    private val transport = FakeFolderTransport()
    private val server = transport.server

    private class Phone(val settings: BackupSettingsRepository, val folders: BackupFolders) {
        suspend fun folderId(bucketId: Long, albumName: String) = folders.folderFor(bucketId, albumName).folderId
    }

    private fun TestScope.phone(): Phone {
        val settings = settingsRepository(files)
        return Phone(settings, BackupFolders(settings, transport))
    }

    @Test fun `the first album makes Phone backup and its subfolder and stores both ids`() = runTest {
        val phone = phone()

        val camera = phone.folderId(1, "Camera")

        assertEquals("Phone backup/Camera", server.path(camera))
        val settings = phone.settings.current()
        assertEquals("Phone backup", server.path(settings.folderId!!))
        assertEquals("Phone backup", settings.folderName)
        assertEquals(AlbumFolder(camera, "Camera", madeIn = settings.folderId), settings.albumFolder(1))
        assertNull(settings.folderNotice)
    }

    @Test fun `a stored folder is used again without asking the server, even after a rename there`() = runTest {
        val phone = phone()
        val camera = phone.folderId(1, "Camera")
        server.rename(camera, "Holiday photos")
        server.creates = 0

        assertEquals(camera, phone.folderId(1, "Camera"))
        assertEquals(0, server.creates)
    }

    @Test fun `a chosen destination is the backup folder`() = runTest {
        val phone = phone()
        val chosen = server.add("Old uploads")
        phone.settings.setDestination(chosen, "Old uploads")

        assertEquals("Old uploads/Camera", server.path(phone.folderId(1, "Camera")))
        assertEquals(chosen, phone.settings.current().folderId)
    }

    @Test fun `folders that are already there by name are taken, whatever their case`() = runTest {
        val backup = server.add("phone BACKUP")
        val camera = server.add("camera", backup)
        val phone = phone()

        assertEquals(camera, phone.folderId(1, "Camera"))
        assertEquals(backup, phone.settings.current().folderId)
    }

    @Test fun `a taken name that no folder carries is an error, not a folder`() = runTest {
        val refusing = object : FakeFolderTransport() {
            override suspend fun createFolder(name: String, parentId: String?): String =
                throw ReverieApiException.Http(409, "conflict", "Taken")

            override suspend fun listFolders(parentId: String?) = emptyList<FolderDto>()
        }
        val folders = BackupFolders(settingsRepository(files), refusing)

        val thrown = runCatching { folders.folderFor(1, "Camera") }.exceptionOrNull()

        assertEquals(409, (thrown as ReverieApiException.Http).statusCode)
    }

    @Test fun `two albums of one name share a folder`() = runTest {
        val phone = phone()

        val dcim = phone.folderId(1, "Screenshots")
        val pictures = phone.folderId(2, "screenshots")

        assertEquals(dcim, pictures)
        assertEquals(dcim, phone.settings.current().albumFolder(2)?.folderId)
    }

    @Test fun `a subfolder that is gone is made again and used`() = runTest {
        val phone = phone()
        val first = phone.folderId(1, "Camera")
        server.delete(first)

        val used = phone.folders.useFolder(1, "Camera") { it.also(server::assertTakesFiles) }

        assertNotEquals(first, used)
        assertEquals("Phone backup/Camera", server.path(used))
    }

    @Test fun `forgetting a folder that was already replaced keeps the new one`() = runTest {
        val phone = phone()
        val camera = phone.folderId(1, "Camera")

        phone.settings.forgetAlbumFolder(1, "an older id")

        assertEquals(camera, phone.settings.current().albumFolder(1)?.folderId)
    }

    @Test fun `a Phone backup that is gone is made again and the notice says so`() = runTest {
        val phone = phone()
        phone.folderId(1, "Camera")
        val first = phone.settings.current().folderId!!
        server.delete(first)

        val screenshots = phone.folderId(2, "Screenshots")

        assertEquals("Phone backup/Screenshots", server.path(screenshots))
        assertNotEquals(first, phone.settings.current().folderId)
        assertEquals("The “Phone backup” folder was gone, so it was made again.", phone.settings.current().folderNotice)
        assertNull("Camera's folder went with the old one", phone.settings.current().albumFolder(1))
    }

    @Test fun `a chosen backup folder that is gone gives way to Phone backup and the notice names both`() = runTest {
        val phone = phone()
        phone.settings.setDestination("deleted", "Trips")

        val camera = phone.folderId(1, "Camera")

        assertEquals("Phone backup/Camera", server.path(camera))
        assertEquals(
            "The backup folder “Trips” is gone, so new uploads go to “Phone backup” in My files.",
            phone.settings.current().folderNotice,
        )
    }

    @Test fun `picking a folder clears the notice`() = runTest {
        val phone = phone()
        phone.settings.setDestination("deleted", "Trips")
        phone.folderId(1, "Camera")

        phone.settings.setDestination(server.add("Archive"), "Archive")

        assertNull(phone.settings.current().folderNotice)
    }

    @Test fun `after the backup folder changes, albums get subfolders of the new one`() = runTest {
        val phone = phone()
        val old = phone.folderId(1, "Camera")
        val archive = server.add("Archive")

        phone.settings.setDestination(archive, "Archive")
        val new = phone.folderId(1, "Camera")

        assertEquals("Archive/Camera", server.path(new))
        assertEquals("the old folder is left as it was", "Phone backup/Camera", server.path(old))
    }

    @Test fun `a folder stored without a backup folder of its own holds when that changes`() = runTest {
        val phone = phone()
        phone.settings.chooseAlbumFolder(1, "elsewhere", "Elsewhere")

        phone.settings.setDestination(server.add("Archive"), "Archive")

        assertEquals("elsewhere", phone.folderId(1, "Camera"))
    }

    @Test fun `a folder the user picks while one is being made wins`() = runTest {
        val phone = phone()
        val picked = server.add("Picked")
        transport.beforeCreate = { if (it == DEFAULT_BACKUP_FOLDER) phone.settings.setDestination(picked, "Picked") }

        val camera = phone.folderId(1, "Camera")

        assertEquals("Picked/Camera", server.path(camera))
        assertEquals(picked, phone.settings.current().folderId)
    }

    @Test fun `a folder the user picks for an album while its subfolder is being made wins`() = runTest {
        val phone = phone()
        val photos = server.add("Photos")
        transport.beforeCreate = { if (it == "Camera") phone.settings.chooseAlbumFolder(1, photos, "Photos") }

        assertEquals(photos, phone.folderId(1, "Camera"))
        assertEquals(AlbumFolder(photos, "Photos"), phone.settings.current().albumFolder(1))
    }

    @Test fun `an album name is made into one the server accepts`() {
        assertEquals("WhatsApp - Sent", toFolderName(" WhatsApp / Sent "))
        assertEquals("a-b-c", toFolderName("a\\b\u0000c"))
        assertEquals("Unnamed album", toFolderName("  "))
        assertEquals(255, toFolderName("x".repeat(300)).length)
    }
}
