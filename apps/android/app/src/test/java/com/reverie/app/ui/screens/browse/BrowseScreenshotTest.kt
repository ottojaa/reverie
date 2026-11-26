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
import app.cash.paparazzi.Paparazzi
import com.android.resources.NightMode
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Renders the real header, floating chips, list screens of Browse from fixed documents.
 * Thumbnails are not fetched in a screenshot test, so pictures show their placeholder.
 */
class BrowseScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(nightMode = NightMode.NIGHT))

    private val today = LocalDate.of(2026, 11, 23)
    private val zone = ZoneOffset.UTC
    private val layout = FeedLayout(GridLayoutMode.UNIFORM, featureEvery = 8, today = today, zone = zone)

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

    private val noRowActions = RowActions(selected = { false }, onClick = {}, onLongClick = {})
    // What a list header with a subtitle measures (status bar + compact title block); only the half-hidden shot needs the number.
    private val headerHeight = 96.dp

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
    private fun ListScreen(source: FeedSource, subtitle: String, documents: List<DocumentDto>, scrolledTo: Int? = null) {
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = scrolledTo ?: 0)
        val body: @Composable () -> Unit = {
            FeedList(
                source = source, documents = documents, hasMore = false, listState = listState,
                contentPadding = PaddingValues(bottom = 24.dp), layout = layout, actions = noRowActions,
                focusedId = null, onFocusConsumed = {}, onLoadMore = {},
            )
        }
        ReverieTheme {
            Surface(color = MaterialTheme.colorScheme.background) {
                if (scrolledTo != null) {
                    Box(Modifier.fillMaxSize()) {
                        body()
                        ScrollChips(
                            heading = headingNow(source, documents, scrolledTo), processingCount = 2, onProcessingClick = {},
                            visibility = { 1f }, modifier = Modifier.align(Alignment.TopCenter),
                        )
                    }
                    return@Surface
                }
                Column(Modifier.fillMaxSize()) {
                    BrowseHeader(
                        title = BrowseTitle(source.title, subtitle, compact = true), processingCount = 2, onProcessingClick = {},
                        onBack = {},
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
                        FeedList(
                            source = FeedSource.PHOTOS, documents = photoLibrary, hasMore = false, listState = listState,
                            contentPadding = PaddingValues(bottom = 24.dp), layout = layout, actions = noRowActions,
                            focusedId = null, onFocusConsumed = {}, onLoadMore = {},
                        )
                    }
                    ScrollChips(
                        heading = headingNow(FeedSource.PHOTOS, photoLibrary, 0), processingCount = 2, onProcessingClick = {},
                        visibility = { 0.5f }, modifier = Modifier.align(Alignment.TopCenter),
                    )
                    BrowseHeader(
                        title = BrowseTitle("Photos", FeedSource.PHOTOS.subtitle(38).orEmpty(), compact = true),
                        processingCount = 2, onProcessingClick = {}, onBack = {},
                        modifier = Modifier.align(Alignment.TopCenter).graphicsLayer { translationY = offset },
                    )
                }
            }
        }
    }

    /** The heading a list scrolled to [index] sits under, computed the way the feed reports it. */
    private fun headingNow(source: FeedSource, documents: List<DocumentDto>, index: Int): FeedItem.Header? =
        headingAt(feedRows(source, documents, emptySet(), 390f, layout), index)

    @Test fun kindPhotos() = paparazzi.snapshot { ListScreen(FeedSource.PHOTOS, "38 photos", photoLibrary) }

    @Test fun kindVideos() = paparazzi.snapshot { ListScreen(FeedSource.VIDEOS, "19 videos", videoLibrary) }

    @Test fun kindFiles() = paparazzi.snapshot { ListScreen(FeedSource.FILES, "191 files", fileLibrary) }

    @Test fun kindPhotosScrolled() = paparazzi.snapshot { ListScreen(FeedSource.PHOTOS, "38 photos", photoLibrary, scrolledTo = 3) }

    @Test fun unfiledList() = paparazzi.snapshot { ListScreen(FeedSource.UNFILED, "4 files", fileLibrary) }

    @Test fun recentList() = paparazzi.snapshot { ListScreen(FeedSource.RECENT, "", newestFirst) }

    @Test fun headerHalfHidden() = paparazzi.snapshot { HalfHiddenScreen() }
}
