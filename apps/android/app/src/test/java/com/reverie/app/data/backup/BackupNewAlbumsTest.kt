package com.reverie.app.data.backup

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class BackupNewAlbumsTest {
    @get:Rule
    val files = TemporaryFolder()

    private val camera = BackupAlbum(1, "Camera", 3)
    private val screenshots = BackupAlbum(2, "Screenshots", 2)
    private val instagram = BackupAlbum(3, "Instagram", 12)

    private suspend fun BackupSettingsRepository.news(vararg albums: BackupAlbum) = newAlbums(albums.toList(), current())

    @Test fun `what is on the phone at the first look is not new`() = runTest {
        val settings = settingsRepository(files)
        settings.setBuckets(setOf(1L))
        assertEquals(emptyList<BackupAlbum>(), settings.news(camera, screenshots))

        settings.seedKnownAlbums(setOf(1L, 2L))

        assertEquals(emptyList<BackupAlbum>(), settings.news(camera, screenshots))
    }

    @Test fun `an album that appears later is new, however many looks come after`() = runTest {
        val settings = settingsRepository(files)
        settings.setBuckets(setOf(1L))
        settings.seedKnownAlbums(setOf(1L, 2L))

        settings.seedKnownAlbums(setOf(1L, 2L, 3L))

        assertEquals(listOf(instagram), settings.news(camera, screenshots, instagram))
    }

    /** The phone gives a renamed album a new id. */
    @Test fun `a renamed album is new, ticked or not under its old name`() = runTest {
        val settings = settingsRepository(files)
        settings.setBuckets(setOf(1L))
        settings.seedKnownAlbums(setOf(1L, 2L))
        val renamed = listOf(camera.copy(bucketId = 10, name = "Holiday"), screenshots.copy(bucketId = 20, name = "Grabs"))

        assertEquals(renamed, settings.news(*renamed.toTypedArray()))
    }

    @Test fun `a new album stops being new once it is ticked, and stays known when unticked`() = runTest {
        val settings = settingsRepository(files)
        settings.setBuckets(setOf(1L))
        settings.seedKnownAlbums(setOf(1L))

        settings.setBuckets(setOf(1L, 3L))
        assertEquals(emptyList<BackupAlbum>(), settings.news(camera, instagram))

        settings.setBuckets(setOf(1L))
        assertEquals(emptyList<BackupAlbum>(), settings.news(camera, instagram))
    }

    @Test fun `an album waved off is not asked about again`() = runTest {
        val settings = settingsRepository(files)
        settings.setBuckets(setOf(1L))
        settings.seedKnownAlbums(setOf(1L))

        settings.markAlbumKnown(3)

        assertEquals(listOf(screenshots), settings.news(camera, screenshots, instagram))
        assertEquals(setOf(1L), settings.current().bucketIds)
    }

    @Test fun `a phone with no albums at the first look has all later ones announced`() = runTest {
        val settings = settingsRepository(files)
        settings.setBuckets(emptySet())

        settings.seedKnownAlbums(emptySet())

        assertEquals(listOf(camera), settings.news(camera))
    }

    @Test fun `nothing is new before albums were ever chosen`() = runTest {
        val settings = settingsRepository(files)
        settings.seedKnownAlbums(setOf(1L))

        assertNull(settings.current().bucketIds)
        assertEquals(emptyList<BackupAlbum>(), settings.news(camera, instagram))
    }

    @Test fun `an album knows how many of its files are videos`() {
        val video = media(2).copy(mimeType = "video/mp4")

        assertEquals(listOf(BackupAlbum(1, "Camera", 2, videos = 1)), toAlbums(listOf(media(1), video)))
    }
}
