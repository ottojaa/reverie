package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.Density
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.settings.FolderViewMode
import com.reverie.app.ui.components.SelectionTopBar
import com.reverie.app.ui.screens.collections.CollectionsFixtures
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * The folder page's header, chips, body and selection bar, from a folder shaped like the design boards'.
 * Every state renders dark and light. Blurhashes stand in for thumbnails: a screenshot test has no network.
 * Recorded images sit in src/test/snapshots/images, named `…FolderScreenshotTest_<state>_<theme>.png`.
 */
class FolderScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val today = LocalDate.of(2026, 11, 25)

    private fun item(name: String, mime: String, day: String, bytes: Long, seconds: Double? = null): DocumentDto {
        val at = "${day}T12:00:00Z"
        val isFile = mime.startsWith("application/") || mime.startsWith("text/")
        return doc(name, mime, created = at, taken = at.takeUnless { isFile }, name = name).copy(
            size_bytes = bytes,
            duration_seconds = seconds,
            thumbnail_blurhash = CollectionsFixtures.hashes[name.hashCode().mod(CollectionsFixtures.hashes.size)].takeUnless { isFile },
        )
    }

    private fun photo(stamp: String, day: String) = item("PXL_$stamp.jpg", "image/jpeg", day, 3_400_000)

    private fun video(stamp: String, day: String, seconds: Double) = item("PXL_$stamp.mp4", "video/mp4", day, 48_000_000, seconds)

    private fun pdf(name: String, day: String, bytes: Long) = item(name, "application/pdf", day, bytes)

    private val boardingPass = pdf("boarding-pass-LIS.pdf", "2026-06-21", 182_000)
    private val itinerary = item("itinerary.md", "text/markdown", "2026-06-20", 6_000)

    private val mixed = listOf(
        photo("20250621_194512", "2026-06-21"), video("20250621_101830", "2026-06-21", 42.0), boardingPass,
        photo("20250620_163002", "2026-06-20"), photo("20250620_090415", "2026-06-20"), itinerary,
        photo("20250619_212244", "2026-06-19"), video("20250619_184010", "2026-06-19", 78.0),
        photo("20250619_140533", "2026-06-19"), photo("20250618_203317", "2026-06-18"),
        photo("20250618_171140", "2026-06-18"), photo("20250618_112908", "2026-06-18"),
        photo("20250617_080000", "2026-06-17"), photo("20250617_070000", "2026-06-17"), photo("20250616_070000", "2026-06-16"),
    )
    private val photos = mixed.filter { it.kind == DocumentKind.IMAGE }
    private val files = listOf(
        boardingPass, itinerary,
        pdf("hotel-alfama-booking.pdf", "2026-05-12", 240_000), pdf("car-rental-faro.pdf", "2025-12-03", 96_000),
    )
    private val starred = setOf(mixed.first().id, boardingPass.id)

    private fun summary(photos: Int, videos: Int = 0, files: Int = 0) =
        DocumentSummaryDto(image = KindTotalsDto(photos), video = KindTotalsDto(videos), file = FileTotalsDto(files))

    private fun folder(
        documents: List<DocumentDto>,
        selected: DocumentKind? = null,
        summary: DocumentSummaryDto = summary(24, 3, 4),
        selectedIds: Set<String> = emptySet(),
    ) = FolderState(
        chips = folderChips(summary, emptySet()),
        selected = selected,
        feed = FeedState(FeedDocuments(documents, total = documents.size, hasMore = false, fetched = true), selectedIds),
        total = DocumentKind.entries.sumOf { summary.countOf(it) },
    )

    @Composable
    private fun Page(state: FolderState, mode: FolderViewMode, name: String, description: String?) = Box(Modifier.fillMaxSize()) {
        val selectedIds = state.feed.selectedIds
        val actions = RowActions(selected = { it.id in selectedIds }, onClick = {}, onLongClick = {}, starred = { it.id in starred })
        Column(Modifier.fillMaxSize()) {
            BrowseHeader(
                title = BrowseTitle(name, folderPageSubtitle(state.total, state.matching, description), isFolder = true, compact = true),
                processingCount = 0, onProcessingClick = {}, onCanvas = {}, onBack = {},
                actions = { ViewSwitch(mode) {} },
                below = { FolderChipRow(state.chips, state.selected) {} },
            )
            Box(Modifier.weight(1f)) {
                FolderBody(
                    state = state, viewMode = mode, actions = actions, today = today, zone = ZoneOffset.UTC,
                    focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null,
                    slot = ChromeSlot(Modifier, PaddingValues(bottom = 24.dp), onHeading = {}, onUpload = {}),
                )
            }
        }
        if (selectedIds.isNotEmpty()) SelectionTopBar(selectedIds.size, onClose = {}, onDownload = {}, onDelete = {})
    }

    private fun both(
        state: String,
        folder: FolderState,
        mode: FolderViewMode,
        name: String = "Portugal - 2025",
        description: String? = null,
    ) {
        CollectionsFixtures.warmBlurhashes()
        listOf(ThemeMode.DARK to "dark", ThemeMode.LIGHT to "light").forEach { (theme, themeName) ->
            paparazzi.snapshot("${state}_$themeName") {
                // Inspection mode makes Coil draw the placeholder (the blurhash) instead of nothing.
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    ReverieTheme(themeMode = theme) {
                        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
                            Page(folder, mode, name, description)
                        }
                    }
                }
            }
        }
    }

    @Test fun gridAll() = both("gridAll", folder(mixed), FolderViewMode.GRID)

    @Test fun gridPhotos() = both("gridPhotos", folder(photos, DocumentKind.IMAGE), FolderViewMode.GRID)

    @Test fun listAll() = both("listAll", folder(mixed), FolderViewMode.LIST)

    @Test fun listFiles() = both("listFiles", folder(files, DocumentKind.FILE), FolderViewMode.LIST)

    @Test fun singleKind() = both("singleKind", folder(photos, summary = summary(photos.size)), FolderViewMode.GRID)

    @Test fun empty() = both("empty", folder(emptyList(), summary = summary(0)), FolderViewMode.GRID, name = "Receipts")

    @Test fun selectionGrid() = both(
        "selectionGrid",
        folder(mixed, selectedIds = setOf(mixed[0].id, mixed[1].id, boardingPass.id)),
        FolderViewMode.GRID,
    )

    @Test fun selectionList() = both(
        "selectionList",
        folder(mixed, selectedIds = setOf(mixed[0].id, boardingPass.id)),
        FolderViewMode.LIST,
    )

    private val longNames = listOf(
        pdf("Lease agreement – Kalevankatu 12, signed copy with appendices.pdf", "2026-06-21", 18_400_000),
        video("20250621_101830", "2025-06-21", 5_025.0).copy(is_private = true),
        photo("20250620_163002", "2026-06-20").copy(is_private = true),
        item("reverie-android-1.12.0-release-unsigned-universal.apk", "application/vnd.android.package-archive", "2025-06-18", 412_000_000),
    )

    /** A 320dp-wide phone, long names, big counts and a described folder: the chip row has to scroll. */
    private fun narrow(state: String, mode: FolderViewMode) {
        paparazzi.unsafeUpdateConfig(DeviceConfig.PIXEL_5.copy(screenWidth = 640, screenHeight = 1280, xdpi = 320, ydpi = 320, density = Density.XHIGH))
        both(
            state, folder(longNames, summary = summary(1_204, 118, 2_391)), mode,
            name = "Apartment paperwork and house moving", description = "Everything about the flat",
        )
    }

    @Test fun narrowGrid() = narrow("narrowGrid", FolderViewMode.GRID)

    @Test fun narrowList() = narrow("narrowList", FolderViewMode.LIST)
}
