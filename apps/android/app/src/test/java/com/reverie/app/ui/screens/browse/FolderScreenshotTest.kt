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
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.MediaDatesDto
import com.reverie.app.data.api.model.kind
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

    private fun item(name: String, mime: String, day: String, bytes: Long, seconds: Double? = null): DocumentDto {
        val at = "${day}T12:00:00Z"
        val isFile = mime.startsWith("application/") || mime.startsWith("text/")
        return doc(name, mime, created = at, taken = at.takeUnless { isFile }, name = name).copy(
            size_bytes = bytes,
            duration_seconds = seconds,
            thumbnail_blurhash = BLURHASHES[name.hashCode().mod(BLURHASHES.size)].takeUnless { isFile },
        )
    }

    private fun photo(stamp: String, day: String) = item("PXL_$stamp.jpg", "image/jpeg", day, 3_400_000)

    private fun video(stamp: String, day: String, seconds: Double) = item("PXL_$stamp.mp4", "video/mp4", day, 48_000_000, seconds)

    private fun pdf(name: String, day: String, bytes: Long) = item(name, "application/pdf", day, bytes)

    /** Four days of a trip, busiest first. */
    private val trip = listOf("25" to 5, "24" to 7, "23" to 4, "21" to 9).flatMap { (day, count) ->
        (1..count).map { photo("202508${day}_1${it}3012", "2025-08-$day") }
    } + video("20250821_101830", "2025-08-21", 42.0)

    private val boardingPass = pdf("boarding-pass-LIS.pdf", "2025-08-20", 182_000)
    private val files = listOf(
        boardingPass, item("itinerary.md", "text/markdown", "2025-08-19", 6_000),
        pdf("hotel-alfama-booking.pdf", "2025-05-12", 240_000),
    )

    private fun counted(documents: List<DocumentDto>) = KindCountsDto(
        image = documents.count { it.kind == DocumentKind.IMAGE },
        video = documents.count { it.kind == DocumentKind.VIDEO },
        file = documents.count { it.kind == DocumentKind.FILE },
    )

    private fun sub(id: String, photos: Int, files: Int = 0, folders: Int = 0) =
        node(id, parent = "here", children = (1..folders).map { node("$id-$it", parent = id) })
            .copy(kind_counts = KindCountsDto(image = photos, file = files))

    private val subfolders = listOf(
        sub("Lisbon", photos = 63, folders = 2), sub("Japan 2024", photos = 214), sub("Tickets", photos = 0, files = 12),
        sub("Packing lists", photos = 0),
        node("Passports", parent = "here", isPrivate = true, locked = true),
    )

    private fun folder(
        name: String,
        media: List<DocumentDto> = emptyList(),
        files: List<DocumentDto> = emptyList(),
        children: List<FolderWithChildren> = emptyList(),
        above: List<String> = listOf("Photos"),
        selectedIds: Set<String> = emptySet(),
    ): FolderState {
        val own = counted(media + files)
        // A row's counts cover everything beneath the folder.
        val counts = own.copy(
            image = own.image + children.sumOf { it.kind_counts.image },
            file = own.file + children.sumOf { it.kind_counts.file },
        )
        val shown = node(name, parent = above.lastOrNull(), children = children).copy(kind_counts = counts)
        val dates = media.map { it.taken_at.orEmpty() }.sorted()
        return FolderState(
            node = shown,
            path = above.map { node(it) } + shown,
            media = FeedDocuments(media, total = media.size, fetched = true),
            files = FeedDocuments(files, total = files.size, fetched = true),
            summary = DocumentSummaryDto(
                image = KindTotalsDto(own.image), video = KindTotalsDto(own.video), file = FileTotalsDto(own.file),
                media_dates = dates.takeIf { it.isNotEmpty() }?.let { MediaDatesDto(it.first(), it.last()) },
            ),
            selectedIds = selectedIds,
        )
    }

    @Composable
    private fun Page(state: FolderState, description: String?) = Box(Modifier.fillMaxSize()) {
        val name = if (state.isRoot) ROOT_NAME else state.node?.name.orEmpty()
        val selectedIds = state.selectedIds
        val starred = setOf(boardingPass.id, trip.first().id)
        val actions = RowActions(selected = { it.id in selectedIds }, onClick = {}, onLongClick = {}, starred = { it.id in starred })
        val covers = listOf("Lisbon", "Japan 2024").associateWith { photoCover(it) }
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
                    layout = layout, actions = actions, focusedId = null, onFocusConsumed = {}, onLoadMore = {},
                    error = null, slot = ChromeSlot(Modifier, PaddingValues(bottom = 24.dp), onTopDate = {}, onUpload = {}),
                )
            }
        }
        val listed = state.media.documents + state.files?.documents.orEmpty()
        val picked = pickFrom(selectedIds, listed, state.children)
        if (!picked.isEmpty) PickedTopBar(picked, isStarred = false, canDownload = true, onClose = {}, onPick = {})
    }

    private fun shoot(state: String, folder: FolderState, description: String? = null) =
        paparazzi.snapshotThemes(state) { Page(folder, description) }

    @Test fun subfolders() = shoot(
        "subfolders",
        folder("Trips", media = trip.take(5), children = subfolders),
    )

    @Test fun photos() = shoot("photos", folder("Portugal – 2025", media = trip))

    @Test fun mixed() = shoot("mixed", folder("Portugal – 2025", media = trip.take(6), files = files), "The August trip")

    /** The root, "My files": the top-level folders, then the files that sit beside them. */
    @Test fun myFiles() {
        val state = folder("root", files = files, children = subfolders, above = emptyList())
        paparazzi.snapshotThemes("myFiles") { Page(state.copy(node = null, path = emptyList(), isRoot = true), null) }
    }

    @Test fun filesOnly() = shoot("filesOnly", folder("Bookings", files = files, above = listOf("Trips", "Portugal – 2025")))

    @Test fun empty() = shoot("empty", folder("Receipts", above = emptyList()))

    @Test fun selection() = shoot(
        "selection",
        folder("Portugal – 2025", media = trip.take(6), files = files, selectedIds = setOf(trip[0].id, trip[1].id, boardingPass.id)),
    )

    @Test fun oneFolderSelected() = shoot(
        "oneFolderSelected",
        folder("Trips", media = trip.take(3), children = subfolders, selectedIds = setOf(subfolders.first().id)),
    )

    /** A 320dp-wide phone with long names and a deep path. */
    @Test fun narrow() {
        paparazzi.unsafeUpdateConfig(DeviceConfig.PIXEL_5.copy(screenWidth = 640, screenHeight = 1280, xdpi = 320, ydpi = 320, density = Density.XHIGH))
        val long = listOf(
            pdf("Lease agreement – Kalevankatu 12, signed copy with appendices.pdf", "2026-06-21", 18_400_000),
            item("reverie-android-1.12.0-release-unsigned-universal.apk", "application/vnd.android.package-archive", "2025-06-18", 412_000_000),
        )
        val state = folder(
            "Apartment paperwork and house moving",
            files = long,
            children = listOf(sub("Insurance claims and correspondence", photos = 1_204, folders = 12)),
            above = listOf("Household administration", "Helsinki flats"),
        )
        shoot("narrow", state, "Everything about the flat, from the first viewing to the final inspection")
    }
}
