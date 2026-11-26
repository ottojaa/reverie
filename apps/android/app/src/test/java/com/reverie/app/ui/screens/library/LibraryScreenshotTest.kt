package com.reverie.app.ui.screens.library

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.Density
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.ui.BLURHASHES
import com.reverie.app.ui.components.AccountButton
import com.reverie.app.ui.components.LIBRARY_NAME
import com.reverie.app.ui.navigation.BottomPill
import com.reverie.app.ui.navigation.Tab
import com.reverie.app.ui.photoCover
import com.reverie.app.ui.screens.browse.BrowseHeader
import com.reverie.app.ui.screens.browse.BrowseTitle
import com.reverie.app.ui.screens.browse.ChromeSlot
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.manage.PickedTopBar
import com.reverie.app.ui.screens.manage.RowSelection
import com.reverie.app.ui.screens.manage.pickFrom
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * The Library page, header to bottom pill, with a library shaped like the design board's.
 * Recorded images sit in src/test/snapshots/images, named `…LibraryScreenshotTest_<state>_<theme>.png`.
 */
class LibraryScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private fun item(name: String, mime: String, at: String, bytes: Long, picture: Boolean, seconds: Double? = null): DocumentDto =
        doc(name, mime, created = at, name = name).copy(
            size_bytes = bytes,
            duration_seconds = seconds,
            thumbnail_blurhash = BLURHASHES[name.length % BLURHASHES.size].takeIf { picture },
        )

    private fun apk(build: String, at: String) =
        item("reverie-1.0.27-$build.apk", "application/vnd.android.package-archive", at, 6_600_000, picture = false)

    private val screenshot =
        item("Screenshot_2026-11-24-00-55-25.jpg", "image/jpeg", "2026-11-25T00:55:00Z", 2_600_000, picture = true)
    private val recording =
        item("Record_2026-11-24-00-14-04.mp4", "video/mp4", "2026-11-25T00:14:00Z", 9_000_000, picture = true, seconds = 12.0)
    private val results =
        item("lunamux-work-laptop-test-results.md", "text/markdown", "2026-11-09T10:00:00Z", 4_100, picture = false)
    private val photo = item("PXL_20250821_101830.jpg", "image/jpeg", "2026-11-02T10:00:00Z", 3_400_000, picture = true)
    private val statement =
        item("bank-statement-october.pdf", "application/pdf", "2026-11-01T10:00:00Z", 220_000, picture = true)

    private val archive =
        item("photos-export-2026.zip", "application/zip", "2026-11-10T10:00:00Z", 48_000_000, picture = false)

    private val added = listOf(
        apk("b61deee", "2026-11-26T19:01:00Z"), apk("855423e", "2026-11-25T15:00:00Z"), screenshot, recording,
    )
    private val loose = listOf(added[0], screenshot, results)

    private fun folder(name: String, folders: Int = 0, image: Int = 0, video: Int = 0, file: Int = 0) =
        node(name, children = (1..folders).map { node("$name-$it", parent = name) })
            .copy(kind_counts = KindCountsDto(image = image, video = video, file = file))

    private val folders = listOf(
        folder("Coding", folders = 1, file = 14),
        node("Importanter", isPrivate = true, locked = true),
        folder("Videos", folders = 1, video = 16),
        folder("App Releases", folders = 1, file = 92),
        folder("Other", folders = 2, file = 10),
        folder("Photos", folders = 5, image = 27),
        folder("Bank Documents"),
    )

    private val full = LibraryState(
        summary = DocumentSummaryDto(KindTotalsDto(126), KindTotalsDto(49), FileTotalsDto(77)),
        covers = KindCovers(photo = photo, video = recording, files = listOf(added[0], archive, results, statement)),
        smartViews = listOf(
            QuickFilter("screenshots", "Screenshots", "q", count = 45),
            QuickFilter("receipts", "Receipts", "q", count = 3),
            QuickFilter("statements", "Statements", "q", count = 9),
            QuickFilter("large-files", "Large files", "q", count = 52),
        ),
        folders = folders,
        recent = FeedState(FeedDocuments(added, total = 252, fetched = true)),
        unfiled = FeedDocuments(loose, total = 7, fetched = true),
    )

    @Composable
    private fun Page(state: LibraryState, backup: BackupStatus) = Box(Modifier.fillMaxSize()) {
        val selectedIds = state.selectedIds
        val rows = RowActions(
            selected = { it.id in selectedIds }, onClick = {}, onLongClick = {}, starred = { it.id == screenshot.id },
        )
        val covers = listOf("Coding", "Videos", "App Releases", "Other", "Photos").associateWith { photoCover(it) }
        Column(Modifier.fillMaxSize()) {
            BrowseHeader(
                title = BrowseTitle(LIBRARY_NAME, subtitle = ""),
                processingCount = 0, onProcessingClick = {}, onBack = null,
                actions = {
                    IconButton(onClick = {}) { Icon(Icons.Outlined.Add, contentDescription = null) }
                    AccountButton(backup, onClick = {})
                },
            )
            Box(Modifier.weight(1f)) {
                LibraryBody(
                    state = state,
                    marks = LibraryMarks(covers, starredFolderIds = setOf("Coding", "Photos"), favouriteCount = 5, backup = backup),
                    links = LibraryLinks(onOpenFolder = {}, onOpenList = {}, onOpenMyFiles = {}, onOpenFavourites = {}, onSearch = {}, onOpenTrash = {}),
                    actions = LibraryActions(
                        rows, rows, onLoadMore = {}, onNewFolder = {}, onFocusConsumed = {},
                        folders = RowSelection(selectedIds),
                    ),
                    day = LibraryDay(LocalDate.of(2026, 11, 26), ZoneOffset.UTC),
                    slot = ChromeSlot(Modifier, PaddingValues(bottom = 96.dp), onTopDate = {}, onUpload = {}),
                )
            }
        }
        BottomPill(Tab.LIBRARY, onSelect = {}, showSearch = true, onSearch = {}, Modifier.align(Alignment.BottomCenter))
        val picked = pickFrom(selectedIds, state.recent.documents.documents + state.unfiled.documents, state.folders)
        if (!picked.isEmpty) PickedTopBar(picked, isStarred = false, canDownload = true, onClose = {}, onPick = {})
    }

    private fun shoot(name: String, state: LibraryState, backup: BackupStatus = BackupStatus.Complete) =
        paparazzi.snapshotThemes(name) { Page(state, backup) }

    private fun resize(width: Int, height: Int, dpi: Density) = paparazzi.unsafeUpdateConfig(
        DeviceConfig.PIXEL_5.copy(screenWidth = width, screenHeight = height, xdpi = dpi.dpiValue, ydpi = dpi.dpiValue, density = dpi),
    )

    @Test fun screen() = shoot("screen", full)

    /** The whole page at once, on a screen tall enough to hold it. */
    @Test fun wholePage() {
        resize(width = 780, height = 3200, dpi = Density.XHIGH)
        shoot("wholePage", full)
    }

    @Test fun selection() = shoot(
        "selection",
        full.copy(recent = full.recent.copy(selectedIds = setOf(added[0].id, screenshot.id))),
        BackupStatus.Waiting(3),
    )

    @Test fun foldersSelected() {
        resize(width = 780, height = 3200, dpi = Density.XHIGH)
        val selected = setOf("Coding", "Importanter", added[0].id)
        shoot("foldersSelected", full.copy(recent = full.recent.copy(selectedIds = selected)))
    }

    @Test fun empty() = shoot(
        "empty",
        LibraryState(
            summary = DocumentSummaryDto(),
            recent = FeedState(FeedDocuments(fetched = true)),
            unfiled = FeedDocuments(fetched = true),
        ),
        BackupStatus.NotSetUp,
    )

    /** A 320dp-wide phone with long names and large counts. */
    @Test fun narrow() {
        resize(width = 640, height = 2900, dpi = Density.XHIGH)
        shoot(
            "narrow",
            full.copy(
                summary = DocumentSummaryDto(KindTotalsDto(128_406), KindTotalsDto(4_912), FileTotalsDto(77_005)),
                folders = listOf(folder("Household administration and insurance claims", folders = 24, image = 12_044, file = 3_310)) +
                    folders.take(2),
            ),
            BackupStatus.NeedsAttention,
        )
    }
}
