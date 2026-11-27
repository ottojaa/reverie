package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.Density
import com.reverie.app.data.api.model.DocumentCategory
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.MediaDatesDto
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.settings.FolderView
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.BLURHASHES
import com.reverie.app.ui.components.ROOT_NAME
import com.reverie.app.ui.photoCover
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
 * The folder page, header to selection bar, with folders and documents shaped like the design boards'.
 * Recorded images sit in src/test/snapshots/images, named `…FolderScreenshotTest_<state>_<theme>.png`.
 */
class FolderScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val layout = FeedLayout(GridLayoutMode.UNIFORM, 3, LocalDate.of(2026, 11, 25), ZoneOffset.UTC)

    /** A document added, and for a photo or video also taken, at noon on [day]. [isPictured] gives it a preview. */
    private fun item(
        name: String,
        mime: String,
        day: String,
        bytes: Long,
        isPictured: Boolean = !mime.startsWith("application/") && !mime.startsWith("text/"),
    ): DocumentDto {
        val at = "${day}T12:00:00Z"
        val isMedia = mime.startsWith("image/") || mime.startsWith("video/")
        return doc(name, mime, created = at, taken = at.takeIf { isMedia }, name = name, bytes = bytes).copy(
            thumbnail_blurhash = BLURHASHES[name.hashCode().mod(BLURHASHES.size)].takeIf { isPictured },
        )
    }

    private fun photo(stamp: String, day: String, city: String? = null) =
        item("PXL_$stamp.jpg", "image/jpeg", day, 3_400_000).copy(city = city, width = 4080, height = 3072)

    private fun video(stamp: String, day: String, seconds: Double) =
        item("PXL_$stamp.mp4", "video/mp4", day, 48_000_000).copy(duration_seconds = seconds)

    private fun pdf(name: String, day: String, bytes: Long) = item(name, "application/pdf", day, bytes, isPictured = true)

    private fun plain(name: String, mime: String, day: String, bytes: Long) = item(name, mime, day, bytes)

    /** Four days of a trip, busiest first. */
    private val trip = listOf("25" to 5, "24" to 7, "23" to 4, "21" to 9).flatMap { (day, count) ->
        (1..count).map { photo("202508${day}_1${it}3012", "2025-08-$day") }
    } + video("20250821_101830", "2025-08-21", 42.0)

    /** The trip's newest photos with a video among the first of them. */
    private val withVideo = trip.take(1) + video("20250825_101830", "2025-08-25", 42.0) + trip.subList(1, 11)

    private val boardingPass = pdf("boarding-pass-LIS.pdf", "2025-08-20", 182_000)

    /** One of each kind of thing a mixed folder holds, newest first. */
    private val mixed = listOf(
        photo("20261125_090214", "2026-11-25", city = "Suomenlinna"),
        video("20261124_173007", "2026-11-24", 42.0),
        plain("app-release.apk", "application/vnd.android.package-archive", "2026-11-20", 6_400_000),
        plain("bcdr-tabletop-prep.md", "text/markdown", "2026-06-01", 12_300),
        plain("holiday-originals.zip", "application/zip", "2026-05-02", 412_000_000),
        item("household-budget-2026.xlsx", "application/vnd.ms-excel", "2026-02-11", 8_200, isPictured = true),
        pdf("PakuOvelle-Varausvahvistus.pdf", "2025-12-17", 86_016),
    )

    private val files = listOf(
        boardingPass, plain("itinerary.md", "text/markdown", "2025-08-19", 6_000),
        pdf("hotel-alfama-booking.pdf", "2025-05-12", 240_000),
    )

    private fun counted(documents: List<DocumentDto>) = KindCountsDto(
        image = documents.count { it.kind == DocumentKind.IMAGE },
        video = documents.count { it.kind == DocumentKind.VIDEO },
        file = documents.count { it.kind == DocumentKind.FILE },
    )

    private fun sub(id: String, photos: Int = 0, videos: Int = 0, files: Int = 0, folders: Int = 0) =
        node(id, parent = "here", children = (1..folders).map { node("$id-$it", parent = id) })
            .copy(kind_counts = KindCountsDto(image = photos, video = videos, file = files))

    private val subfolders = listOf(
        sub("Japan 2024", photos = 214), sub("Lisbon", photos = 63, folders = 2), sub("Packing lists"),
        node("Passports", parent = "here", isPrivate = true, locked = true), sub("Tickets", files = 12),
    )

    private val topFolders = listOf(
        sub("App Releases", files = 94, folders = 1), sub("Bank Documents", files = 1), sub("Coding", files = 24, folders = 1),
        sub("Other", files = 10), sub("Photos", photos = 28, folders = 5), sub("Videos", videos = 16),
    )

    /** A folder's page as its contents would open it: a grid by date taken where they are all photos and videos. */
    private fun folder(
        name: String,
        documents: List<DocumentDto> = emptyList(),
        children: List<FolderWithChildren> = emptyList(),
        above: List<String> = listOf("Photos"),
    ): FolderState {
        val own = counted(documents)
        val isAllMedia = documents.isNotEmpty() && own.file == 0
        // A row's counts cover everything beneath the folder.
        val counts = own.copy(
            image = own.image + children.sumOf { it.kind_counts.image },
            file = own.file + children.sumOf { it.kind_counts.file },
        )
        val shown = node(name, parent = above.lastOrNull(), children = children).copy(kind_counts = counts)
        val dates = documents.mapNotNull { it.taken_at }.sorted()
        return FolderState(
            node = shown,
            path = above.map { node(it) } + shown,
            documents = FeedDocuments(documents, total = documents.size, fetched = true),
            view = if (isAllMedia) FolderView.GRID else FolderView.LIST,
            filter = if (isAllMedia) DocumentFilter.MEDIA else DocumentFilter.ALL,
            summary = DocumentSummaryDto(
                image = KindTotalsDto(own.image), video = KindTotalsDto(own.video), file = FileTotalsDto(own.file),
                media_dates = dates.takeIf { it.isNotEmpty() }?.let { MediaDatesDto(it.first(), it.last()) },
            ),
        )
    }

    /** The root, "My files": the top-level folders, then the documents that sit beside them. */
    private fun myFilesPage(): FolderState = folder(
        "root",
        documents = listOf(
            photo("20261125_180655", "2026-11-25").copy(
                original_filename = "Screenshot_2026-11-25-18-06-55.jpg", document_category = DocumentCategory.SCREENSHOT,
            ),
            video("20261118_173007", "2026-11-18", 42.0),
            photo("20260714_161226", "2026-07-14", city = "Suomenlinna"),
        ) + mixed.drop(2),
        children = topFolders,
        above = emptyList(),
    ).copy(node = null, path = emptyList(), isRoot = true)

    @Composable
    private fun Page(state: FolderState, description: String?, shownBy: FeedLayout) = Box(Modifier.fillMaxSize()) {
        val name = if (state.isRoot) ROOT_NAME else state.node?.name.orEmpty()
        val selectedIds = state.selectedIds
        val starred = setOf(boardingPass.id, trip.first().id, mixed.last().id)
        val actions = RowActions(selected = { it.id in selectedIds }, onClick = {}, onLongClick = {}, starred = { it.id in starred })
        val covers = listOf("App Releases", "Coding", "Japan 2024", "Lisbon", "Other", "Photos", "Videos")
            .associateWith { photoCover(it) }
        Column(Modifier.fillMaxSize()) {
            BrowseHeader(
                title = null, processingCount = 0, onProcessingClick = {}, onBack = {},
                actions = { FolderActions(name, onSearch = {}, onAdd = {}, onCanvas = {}) },
            )
            Box(Modifier.weight(1f)) {
                FolderBody(
                    state = state, name = name, description = description,
                    links = FolderLinks(
                        covers, starredIds = setOf("Lisbon"), onOpen = {}, onOpenCrumb = {},
                        selection = RowSelection(selectedIds),
                    ),
                    layout = shownBy, actions = actions, focusedId = null, onFocusConsumed = {}, onLoadMore = {},
                    onSort = {}, onShowAs = {},
                    error = null, slot = ChromeSlot(Modifier, PaddingValues(bottom = 24.dp), onTopDate = {}, onUpload = {}),
                )
            }
        }
        val picked = pickFrom(selectedIds, state.documents.documents, state.children)
        if (!picked.isEmpty) PickedTopBar(picked, isStarred = false, canDownload = true, onClose = {}, onPick = {})
    }

    private fun shoot(name: String, state: FolderState, description: String? = null, shownBy: FeedLayout = layout) =
        paparazzi.snapshotThemes(name) { Page(state, description, shownBy) }

    @Test fun myFiles() = shoot("myFiles", myFilesPage())

    @Test fun myFilesGrid() = shoot("myFilesGrid", myFilesPage().copy(view = FolderView.GRID))

    @Test fun mixed() = shoot("mixed", folder("Lisbon 2026", documents = mixed, children = listOf(sub("Tickets", files = 12))))

    @Test fun mixedGrid() = shoot(
        "mixedGrid",
        folder("Lisbon 2026", documents = mixed, children = listOf(sub("Tickets", files = 12))).copy(view = FolderView.GRID),
    )

    @Test fun photos() = shoot(
        "photos",
        folder("Portugal – 2025", documents = withVideo, children = listOf(sub("Lisbon", photos = 63, folders = 2))),
        shownBy = layout.copy(mode = GridLayoutMode.MOSAIC),
    )

    @Test fun subfolders() = shoot("subfolders", folder("Trips", documents = trip.take(5), children = subfolders))

    /** The tile of every other family of file, with and without a preview, under the largest first. */
    @Test fun filesOnly() = shoot(
        "filesOnly",
        folder(
            "Bookings",
            documents = listOf(
                plain("voice-memo.m4a", "audio/mp4", "2026-11-25", 4_100_000),
                item("kickoff.pptx", "application/vnd.ms-powerpoint", "2026-11-24", 2_400_000, isPictured = true),
                plain("lease.docx", "application/msword", "2026-11-20", 310_000),
                plain("Geist.ttf", "font/ttf", "2026-03-08", 96_000),
                plain("MainActivity.kt", "text/plain", "2026-09-02", 28_000),
                plain("export.csv", "text/csv", "2026-08-30", 14_000),
                plain("notes.txt", "text/plain", "2026-07-14", 2_100),
                plain("firmware.bin", "application/octet-stream", "2025-12-17", 1_200),
            ),
            above = listOf("Trips", "Portugal – 2025"),
        ).copy(sort = DocumentSort.SIZE),
    )

    @Test fun empty() = shoot("empty", folder("Receipts", above = emptyList()))

    private val picked = folder("Lisbon 2026", documents = mixed, children = listOf(sub("Tickets", files = 12)))
        .copy(selectedIds = setOf(mixed[0].id, mixed[2].id, mixed.last().id))

    @Test fun selection() = shoot("selection", picked)

    @Test fun selectionGrid() = shoot("selectionGrid", picked.copy(view = FolderView.GRID))

    @Test fun oneFolderSelected() = shoot(
        "oneFolderSelected",
        folder("Trips", documents = trip.take(3), children = subfolders).copy(selectedIds = setOf(subfolders.first().id)),
    )

    @Test fun narrow() = shootNarrow("narrow", FolderView.LIST)

    @Test fun narrowGrid() = shootNarrow("narrowGrid", FolderView.GRID)

    /** A 320dp-wide phone with long names and a deep path. */
    private fun shootNarrow(name: String, view: FolderView) {
        paparazzi.unsafeUpdateConfig(DeviceConfig.PIXEL_5.copy(screenWidth = 640, screenHeight = 1280, xdpi = 320, ydpi = 320, density = Density.XHIGH))
        val long = listOf(
            pdf("Lease agreement – Kalevankatu 12, signed copy with appendices.pdf", "2026-06-21", 18_400_000),
            plain("reverie-android-1.12.0-release-unsigned-universal.apk", "application/vnd.android.package-archive", "2025-06-18", 412_000_000),
            photo("20250614_120000_BURST_COVER_PORTRAIT", "2025-06-14", city = "Llanfairpwllgwyngyllgogerychwyrndrobwll"),
        )
        val state = folder(
            "Apartment paperwork and house moving",
            documents = long,
            children = listOf(sub("Insurance claims and correspondence", photos = 1_204, folders = 12)),
            above = listOf("Household administration", "Helsinki flats"),
        )
        shoot(name, state.copy(view = view), "Everything about the flat, from the first viewing to the final inspection")
    }
}
