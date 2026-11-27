package com.reverie.app.ui.screens.settings.backup

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.data.backup.BackupSettings
import com.reverie.app.data.backup.INCLUDE_EXISTING
import com.reverie.app.data.backup.MediaAccess
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test

class BackupScreenshotTest {

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val albums = listOf(
        BackupAlbum(1, "Camera", 5_842),
        BackupAlbum(2, "Screenshots", 412),
        BackupAlbum(3, "WhatsApp Images", 1_963),
        BackupAlbum(4, "Downloads from the family group, summer 2026 and earlier", 37),
        BackupAlbum(5, "Signal", 88),
        BackupAlbum(6, "Instagram", 14),
    )

    private val onlyNew = BackupUiState(
        settings = BackupSettings(
            enabled = true,
            bucketIds = setOf(1L, 2L, 4L),
            addedAfter = 1_780_000_000,
            lastSuccessAt = System.currentTimeMillis() - 7_200_000,
        ),
        albums = albums,
        access = MediaAccess.Full,
        pending = 3,
        leftAlone = 6_291,
        destinations = BackupDestinations(
            backupFolder = "Phone backup",
            albums = mapOf(
                1L to "Phone backup › Camera",
                2L to "Phone backup › Screenshots",
                4L to "Phone backup › Downloads from the family group, summer 2026 and earlier",
            ),
        ),
    )

    /** A chosen folder deep in the library went away, and everything on the phone is being backed up. */
    private val folderGone = onlyNew.copy(
        settings = onlyNew.settings.copy(
            addedAfter = INCLUDE_EXISTING,
            folderNotice = "The backup folder “Photos from my old phones and cameras” is gone, so new uploads go to " +
                "“Phone backup” in My files.",
        ),
        pending = 6_294,
        leftAlone = 0,
        running = true,
    )

    private val off = BackupUiState(
        settings = BackupSettings(bucketIds = setOf(1L)),
        albums = albums.take(3),
        access = MediaAccess.Full,
        destinations = BackupDestinations(albums = mapOf(1L to "Phone backup › Camera")),
    )

    private fun screen(name: String, state: BackupUiState) =
        paparazzi.snapshotThemes(name) { BackupSettingsContent(state, BackupActions()) }

    @Test fun `backup off`() = screen("off", off)

    @Test fun `only new photos`() = screen("only_new", onlyNew)

    @Test fun `the whole page`() {
        paparazzi.unsafeUpdateConfig(DeviceConfig.PIXEL_5.copy(screenHeight = 3_400))
        screen("whole_page", onlyNew)
        screen("folder_gone", folderGone)
    }

    @Test fun `a narrow screen with large text`() {
        paparazzi.unsafeUpdateConfig(DeviceConfig.PIXEL_5.copy(screenWidth = 880, screenHeight = 5_200, fontScale = 1.3f))
        screen("narrow", folderGone.copy(settings = folderGone.settings.copy(addedAfter = 1_780_000_000)))
    }

    @Test fun `the first choice`() = paparazzi.snapshotThemes("choice") {
        BackupChoiceDialog(existing = 6_291, onOnlyNew = {}, onIncludeExisting = {}, onCancel = {})
    }

    @Test fun `the first choice on a narrow screen with large text`() {
        paparazzi.unsafeUpdateConfig(DeviceConfig.PIXEL_5.copy(screenWidth = 880, screenHeight = 1_600, fontScale = 1.3f))
        paparazzi.snapshotThemes("choice_narrow") {
            BackupChoiceDialog(existing = 6_291, onOnlyNew = {}, onIncludeExisting = {}, onCancel = {})
        }
    }
}
