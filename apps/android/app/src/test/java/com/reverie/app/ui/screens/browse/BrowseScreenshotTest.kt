package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import com.android.resources.Density
import app.cash.paparazzi.Paparazzi
import com.android.resources.NightMode
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.api.model.TopTypeDto
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Renders the real header, floating chips, dashboard and kind feeds of Browse from fixed documents.
 * Thumbnails are not fetched in a screenshot test, so pictures show their placeholder.
 */
class BrowseScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(nightMode = NightMode.NIGHT))

    private val today = LocalDate.of(2026, 11, 23)
    private val zone = ZoneOffset.UTC
    private val layout = FeedLayout(GridLayoutMode.MOSAIC, featureEvery = 8, today = today, zone = zone)

    private fun item(id: String, name: String, mime: String, at: String, bytes: Long = 2_400_000, seconds: Double? = null, w: Int? = null, h: Int? = null) =
        DocumentDto(
            id = id, file_path = "/$id", file_hash = "h$id", original_filename = name, mime_type = mime,
            size_bytes = bytes, width = w, height = h, duration_seconds = seconds,
            ocr_status = JobStatus.COMPLETE, thumbnail_status = JobStatus.COMPLETE, llm_status = JobStatus.COMPLETE,
            is_private = false, created_at = at, updated_at = at, taken_at = if (mime.startsWith("image/") || mime.startsWith("video/")) at else null,
        )

    private fun photo(id: String, at: String, portrait: Boolean = false) =
        item(id, "$id.jpg", "image/jpeg", at, w = if (portrait) 3000 else 4000, h = if (portrait) 4000 else 3000)

    private fun video(id: String, at: String, seconds: Double = 74.0) = item(id, "$id.mp4", "video/mp4", at, bytes = 80_000_000, seconds = seconds)

    private fun minutesAfter(base: String, minutes: Long): String = Instant.parse(base).plusSeconds(minutes * 60).toString()

    // His library's shape: debug APKs (twelve copies of one name), zips, notes, a few screenshots, a batch of 14 videos.
    private val apk = "application/vnd.android.package-archive"
    private val newestFirst: List<DocumentDto> = buildList {
        add(item("apk-latest", "app-release.apk", apk, "2026-11-23T00:10:00Z", 6_200_000))
        add(photo("shot-2", "2026-11-22T19:40:00Z"))
        add(photo("shot-1", "2026-11-22T19:34:00Z"))
        add(item("zip-install", "lunamux-install.zip", "application/zip", "2026-11-19T21:00:00Z", 6_800_000))
        add(item("notes", "release-notes.md", "text/markdown", "2026-11-17T09:00:00Z", 4_000))
        (1..14).forEach { add(video("clip-${15 - it}", minutesAfter("2026-11-06T15:00:00Z", (14L - it) * 2), seconds = 60.0 + it)) }
        (0..11).forEach { add(item("lm-${12 - it}", "lunamux-1.9.0-13.apk", apk, "2026-08-%02dT10:00:00Z".format(26 - it), 41_000_000)) }
        add(item("zip-old", "backup.zip", "application/zip", "2026-08-01T10:00:00Z", 9_000_000))
    }

    private val summary = DocumentSummaryDto(
        image = KindTotalsDto(38, 210_000_000),
        video = KindTotalsDto(19, 1_400_000_000),
        file = FileTotalsDto(191, 2_900_000_000, listOf(TopTypeDto("apk", 120), TopTypeDto("zip", 31), TopTypeDto("md", 22), TopTypeDto("gz", 9))),
    )

    private val strip = (1..4).map { photo("strip-$it", "2026-11-%02dT10:00:00Z".format(23 - it)) }

    private fun dashboardState(docs: List<DocumentDto> = newestFirst, summary: DocumentSummaryDto = this.summary, photos: List<DocumentDto> = strip, expanded: Set<String> = emptySet()) =
        DashboardState(
            summary = summary,
            photoPreview = photos,
            videoPreview = video("preview", "2026-11-06T16:00:00Z"),
            recent = FeedState(FeedDocuments(docs, total = 248, hasMore = true, fetched = true)),
            expanded = expanded,
        )

    private val noRecentActions = RecentActions(emptySet(), {}, {}, {}, {})
    private val noActions = DashboardActions(onOpenKind = {}, recent = noRecentActions)
    private val noRowActions = RowActions(selected = { false }, onClick = {}, onLongClick = {})
    // What the Photos header measures (status bar + compact title block); only the half-hidden shot needs the number.
    private val headerHeight = 96.dp

    @Composable
    private fun Dashboard(state: DashboardState, scrolledTo: Int? = null) {
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = scrolledTo ?: 0)
        val body: @Composable () -> Unit = {
            DashboardBody(
                state = state, listState = listState, contentPadding = PaddingValues(bottom = 24.dp),
                today = today, zone = zone, actions = noActions, focusedId = null, onFocusConsumed = {}, onLoadMore = {},
                error = null, onUpload = {},
            )
        }
        ReverieTheme {
            Surface(color = MaterialTheme.colorScheme.background) {
                if (scrolledTo != null) {
                    // Header slid away: the list fills the screen and the Processing chip floats over it.
                    Box(Modifier.fillMaxSize()) {
                        body()
                        ScrollChips(heading = null, processingCount = 2, onProcessingClick = {}, visibility = { 1f }, modifier = Modifier.align(Alignment.TopCenter))
                    }
                    return@Surface
                }
                // The list sits right under the header, as BrowseChrome places it.
                Column(Modifier.fillMaxSize()) {
                    BrowseHeader(
                        title = BrowseTitle("My Files", dashboardSubtitle(248), isFolder = false),
                        processingCount = 2, onProcessingClick = {}, onCanvas = {}, onBack = null,
                    )
                    Box(Modifier.weight(1f)) { body() }
                }
            }
        }
    }

    private val photoLibrary = (1..23).map { photo("p$it", "2026-11-%02dT%02d:00:00.000Z".format(23 - it / 6, 23 - it % 12), portrait = it % 5 == 0) } +
        (1..9).map { photo("o$it", "2026-10-%02dT10:00:00.000Z".format(30 - it)) }
    private val videoLibrary = listOf(
        video("v1", "2026-11-23T21:00:00.000Z", 74.0), video("v2", "2026-11-22T18:00:00.000Z", 12.0),
        video("v3", "2026-11-20T09:00:00.000Z", 603.0), video("v4", "2026-11-19T09:00:00.000Z", 45.0),
    )
    private val fileLibrary = listOf(
        item("f1", "Lease agreement – Kalevankatu 12.pdf", "application/pdf", "2026-11-23T14:00:00Z", 1_800_000),
        item("f2", "Q3 budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "2026-11-23T09:00:00Z", 90_000),
        item("f3", "scan-0042.pdf", "application/pdf", "2026-11-22T11:00:00Z", 3_000_000),
        item("f4", "notes.md", "text/markdown", "2026-11-20T08:00:00Z", 4_000),
    )

    @Composable
    private fun KindScreen(kind: DocumentKind, title: String, subtitle: String, documents: List<DocumentDto>, scrolledTo: Int? = null) {
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = scrolledTo ?: 0)
        val body: @Composable () -> Unit = {
            KindFeed(
                kind = kind, documents = documents, hasMore = false, listState = listState,
                contentPadding = PaddingValues(bottom = 24.dp), layout = layout, actions = noRowActions,
                focusedId = null, onFocusConsumed = {}, onLoadMore = {}, onHeading = {},
            )
        }
        ReverieTheme {
            Surface(color = MaterialTheme.colorScheme.background) {
                if (scrolledTo != null) {
                    Box(Modifier.fillMaxSize()) {
                        body()
                        ScrollChips(
                            heading = headingNow(kind, documents, scrolledTo), processingCount = 2, onProcessingClick = {},
                            visibility = { 1f }, modifier = Modifier.align(Alignment.TopCenter),
                        )
                    }
                    return@Surface
                }
                Column(Modifier.fillMaxSize()) {
                    BrowseHeader(
                        title = BrowseTitle(title, subtitle, isFolder = false, compact = true), processingCount = 2, onProcessingClick = {},
                        onCanvas = {}, onBack = {},
                    )
                    Box(Modifier.weight(1f)) { body() }
                }
            }
        }
    }

    /** The header halfway through sliding away: the chips fade in as it goes, and the list moves with it. */
    @Composable
    private fun HalfHiddenScreen() {
        val headerPx = with(LocalDensity.current) { headerHeight.roundToPx() }
        val offset = -headerPx / 2f
        val listState = rememberLazyListState()
        ReverieTheme {
            Surface(color = MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().belowHeader(headerPx = { headerPx }, heightOffset = { offset })) {
                        KindFeed(
                            kind = DocumentKind.IMAGE, documents = photoLibrary, hasMore = false, listState = listState,
                            contentPadding = PaddingValues(bottom = 24.dp), layout = layout, actions = noRowActions,
                            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, onHeading = {},
                        )
                    }
                    ScrollChips(
                        heading = headingNow(DocumentKind.IMAGE, photoLibrary, 0), processingCount = 2, onProcessingClick = {},
                        visibility = { 0.5f }, modifier = Modifier.align(Alignment.TopCenter),
                    )
                    BrowseHeader(
                        title = BrowseTitle("Photos", kindSubtitle(DocumentKind.IMAGE, 38), isFolder = false, compact = true),
                        processingCount = 2, onProcessingClick = {}, onCanvas = {}, onBack = {},
                        modifier = Modifier.align(Alignment.TopCenter).graphicsLayer { translationY = offset },
                    )
                }
            }
        }
    }

    /** The heading a list scrolled to [index] sits under, computed the way the feed reports it. */
    private fun headingNow(kind: DocumentKind, documents: List<DocumentDto>, index: Int): FeedItem.Header? =
        headingAt(toRows(buildFeed(kind, documents, today, zone), 390f, layout.mode, layout.featureEvery), index)

    @Test fun dashboard() = paparazzi.snapshot { Dashboard(dashboardState()) }

    @Test fun dashboardNoPhotos() = paparazzi.snapshot {
        Dashboard(dashboardState(summary = summary.copy(image = KindTotalsDto()), photos = emptyList(), docs = newestFirst.filter { it.kind != DocumentKind.IMAGE }))
    }

    @Test fun dashboardFoldExpanded() = paparazzi.snapshot { Dashboard(dashboardState(expanded = setOf("clip-14")), scrolledTo = null) }

    @Test fun dashboardStackExpanded() = paparazzi.snapshot { Dashboard(dashboardState(expanded = setOf("lm-12")), scrolledTo = 4) }

    @Test fun dashboardScrolled() = paparazzi.snapshot { Dashboard(dashboardState(), scrolledTo = 3) }

    @Test fun kindPhotos() = paparazzi.snapshot {
        KindScreen(DocumentKind.IMAGE, "Photos", kindSubtitle(DocumentKind.IMAGE, 38), photoLibrary)
    }

    @Test fun kindVideos() = paparazzi.snapshot {
        KindScreen(DocumentKind.VIDEO, "Videos", kindSubtitle(DocumentKind.VIDEO, 19), videoLibrary)
    }

    @Test fun kindFiles() = paparazzi.snapshot {
        KindScreen(DocumentKind.FILE, "Files", kindSubtitle(DocumentKind.FILE, 191), fileLibrary)
    }

    @Test fun kindPhotosScrolled() = paparazzi.snapshot {
        KindScreen(DocumentKind.IMAGE, "Photos", kindSubtitle(DocumentKind.IMAGE, 38), photoLibrary, scrolledTo = 3)
    }

    /** A 320dp-wide phone and the longest names he has: half-width cards and row names have to hold. */
    @Test fun dashboardNarrow() {
        paparazzi.unsafeUpdateConfig(DeviceConfig.PIXEL_5.copy(screenWidth = 640, screenHeight = 1280, xdpi = 320, ydpi = 320, density = Density.XHIGH, nightMode = NightMode.NIGHT))
        val long = newestFirst.map {
            when (it.id) {
                "apk-latest" -> it.copy(original_filename = "reverie-android-1.12.0-release-unsigned-universal.apk")
                "zip-install" -> it.copy(original_filename = "lunamux-install-bundle-with-a-very-long-name-final-v2.zip")
                else -> it
            }
        }
        paparazzi.snapshot { Dashboard(dashboardState(docs = long, summary = summary.copy(file = summary.file.copy(count = 1191, bytes = 12_900_000_000)))) }
    }

    @Test fun headerHalfHidden() = paparazzi.snapshot { HalfHiddenScreen() }
}
