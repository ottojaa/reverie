package com.reverie.app.ui.screens.settings.backup

import com.reverie.app.data.backup.AlbumFolder
import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.data.backup.BackupSettings
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.screens.destination.node
import org.junit.Assert.assertEquals
import org.junit.Test

class BackupDestinationsTest {
    private val albums = listOf(BackupAlbum(1, "Camera", 3), BackupAlbum(2, "WhatsApp / Sent", 1))
    private val tree = FolderTree(listOf(node("Archive", children = listOf(node("Phone", "Archive", listOf(node("Holidays", "Phone")))))))

    @Test fun `before anything is made, the folders are shown as they will be called`() {
        val destinations = toBackupDestinations(BackupSettings(), albums, FolderTree(emptyList()))

        assertEquals("Phone backup", destinations.backupFolder)
        assertEquals(mapOf(1L to "Phone backup › Camera", 2L to "Phone backup › WhatsApp - Sent"), destinations.albums)
    }

    @Test fun `folders are named as the library has them now, under their parents`() {
        val settings = BackupSettings(
            folderId = "Phone",
            folderName = "Mobile",
            albumFolders = mapOf(1L to AlbumFolder("Holidays", "Camera", madeIn = "Phone")),
        )

        val destinations = toBackupDestinations(settings, albums, tree)

        assertEquals("Archive › Phone", destinations.backupFolder)
        assertEquals("Archive › Phone › Holidays", destinations.albums[1])
        assertEquals("Archive › Phone › WhatsApp - Sent", destinations.albums[2])
    }

    @Test fun `a folder made under another backup folder is no longer shown`() {
        val settings = BackupSettings(
            folderId = "Archive",
            folderName = "Archive",
            albumFolders = mapOf(1L to AlbumFolder("Holidays", "Camera", madeIn = "Phone")),
        )

        assertEquals("Archive › Camera", toBackupDestinations(settings, albums, tree).albums[1])
    }
}
