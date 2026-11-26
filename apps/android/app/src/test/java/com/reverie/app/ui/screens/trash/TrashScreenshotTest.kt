package com.reverie.app.ui.screens.trash

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.ui.snapshotThemes
import java.time.Instant
import org.junit.Rule
import org.junit.Test

/** The trash, dark and light: a folder, a locked folder and files, with names too long for one line. */
class TrashScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val now = Instant.parse("2026-11-01T12:00:00Z")

    @Test fun trash() {
        val listing = TrashListDto(
            folders = listOf(
                trashedFolder("taxes", folders = 2, files = 14, name = "Taxes and receipts 2019–2023", purgeAt = "2026-11-28T12:00:00Z"),
                trashedFolder("vault", locked = true, purgeAt = "2026-11-04T12:00:00Z"),
            ),
            documents = listOf(
                trashedFile("a", "Lisbon apartment booking confirmation – Rua dos Remédios 74.pdf", "2026-11-20T12:00:00Z"),
                trashedFile("b", "IMG_20250823_1004.jpg", "2026-11-02T08:00:00Z").copy(mime_type = "image/jpeg"),
                trashedFile("c", "notes.txt", "2026-11-01T11:00:00Z").copy(mime_type = "text/plain", size_bytes = 812),
            ),
            retention_days = 30,
        )

        paparazzi.snapshotThemes("trash") { TrashContent(TrashUiState(listing = listing), TrashActions({}, {}, {}), now = now) }
    }
}
