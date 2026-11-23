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
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Renders the real header, pinned band and feed of each Browse tab from fixed documents. Thumbnails
 * are not fetched in a screenshot test, so tiles show their placeholder.
 */
class BrowseScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(nightMode = NightMode.NIGHT))

    private val today = LocalDate.of(2026, 11, 23)
    private val layout = FeedLayout(GridLayoutMode.MOSAIC, featureEvery = 8, today = today, zone = ZoneOffset.UTC)

    private fun media(id: String, mime: String, day: Int, hour: Int, width: Int = 4000, height: Int = 3000, seconds: Double? = null): DocumentDto {
        val at = "2026-11-%02dT%02d:00:00.000Z".format(day, hour)
        return DocumentDto(
            id = id, file_path = "/$id", file_hash = "h$id", original_filename = "$id.jpg", mime_type = mime,
            size_bytes = 2_400_000, width = width, height = height, duration_seconds = seconds,
            ocr_status = JobStatus.COMPLETE, thumbnail_status = JobStatus.COMPLETE, llm_status = JobStatus.COMPLETE,
            is_private = false, created_at = at, updated_at = at, taken_at = at,
        )
    }

    private fun file(id: String, name: String, mime: String, day: Int, hour: Int): DocumentDto {
        val at = "2026-11-%02dT%02d:00:00Z".format(day, hour)
        return DocumentDto(
            id = id, file_path = "/$id", file_hash = "h$id", original_filename = name, mime_type = mime,
            size_bytes = 1_800_000, ocr_status = JobStatus.COMPLETE, thumbnail_status = JobStatus.COMPLETE,
            llm_status = JobStatus.COMPLETE, is_private = false, created_at = at, updated_at = at,
        )
    }

    private val photos = (1..23).map { media("p$it", "image/jpeg", day = 23 - it / 6, hour = 23 - it % 12, width = if (it % 5 == 0) 3000 else 4000, height = if (it % 5 == 0) 4000 else 3000) } +
        (1..9).map { media("o$it", "image/jpeg", day = 28 - it, hour = 10).copy(taken_at = "2026-10-%02dT10:00:00.000Z".format(30 - it)) }
    private val videos = listOf(
        media("v1", "video/mp4", 23, 21, seconds = 74.0), media("v2", "video/mp4", 22, 18, seconds = 12.0),
        media("v3", "video/mp4", 20, 9, seconds = 603.0), media("v4", "video/mp4", 19, 9, seconds = 45.0),
        media("v5", "video/mp4", 18, 9, seconds = 7.0),
    )
    private val files = listOf(
        file("f1", "Lease agreement – Kalevankatu 12.pdf", "application/pdf", 23, 14),
        file("f2", "Q3 budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 23, 9),
        file("f3", "Meeting notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 22, 16),
        file("f4", "scan-0042.pdf", "application/pdf", 22, 11),
        file("f5", "notes.md", "text/markdown", 20, 8),
        file("f6", "backup.zip", "application/zip", 19, 22),
    )
    private val all = (photos.take(6) + videos.take(1) + files.take(3) + photos.drop(6).take(8) + videos.drop(1).take(1) + files.drop(3))
        .sortedByDescending { it.created_at }

    private val noActions = RowActions(selected = { false }, onClick = {}, onLongClick = {})

    @Composable
    private fun Screen(tab: BrowseTab, documents: List<DocumentDto>, total: Int, scrolledTo: Int? = null) {
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = scrolledTo ?: 0)
        val headerHeight = 150.dp
        ReverieTheme {
            Surface(color = MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxSize()) {
                    TabFeed(
                        tab = tab, documents = documents, hasMore = false, listState = listState,
                        contentPadding = PaddingValues(top = headerHeight, bottom = 24.dp), layout = layout, actions = noActions,
                        focusedId = null, onFocusConsumed = {}, onLoadMore = {}, onHeading = {},
                    )
                    if (scrolledTo != null) {
                        PinnedBand(
                            heading = headingNow(tab, documents, scrolledTo), processingCount = 2,
                            onProcessingClick = {}, visibility = { 1f }, modifier = Modifier.align(Alignment.TopCenter),
                        )
                        return@Box
                    }
                    BrowseHeader(
                        title = BrowseTitle("My Files", tabSubtitle(tab, total, null), isFolder = false),
                        tab = tab, processingCount = 2, onSelectTab = {}, onProcessingClick = {}, onCanvas = {}, onBack = null,
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                }
            }
        }
    }

    /**
     * The header halfway through sliding away, as the screen lays it out: the body is placed under the
     * header's current bottom edge and is as tall as the room that leaves, so the list moves with it.
     */
    @Composable
    private fun HalfHiddenScreen() {
        val headerPx = with(LocalDensity.current) { 150.dp.roundToPx() }
        val offset = -headerPx / 2f
        val listState = rememberLazyListState()
        ReverieTheme {
            Surface(color = MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().belowHeader(headerPx = { headerPx }, heightOffset = { offset })) {
                        TabFeed(
                            tab = BrowseTab.PHOTOS, documents = photos, hasMore = false, listState = listState,
                            contentPadding = PaddingValues(bottom = 24.dp), layout = layout, actions = noActions,
                            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, onHeading = {},
                        )
                    }
                    PinnedBand(
                        heading = headingNow(BrowseTab.PHOTOS, photos, 0), processingCount = 2,
                        onProcessingClick = {}, visibility = { 0.5f }, modifier = Modifier.align(Alignment.TopCenter),
                    )
                    BrowseHeader(
                        title = BrowseTitle("My Files", tabSubtitle(BrowseTab.PHOTOS, 168, null), isFolder = false),
                        tab = BrowseTab.PHOTOS, processingCount = 2, onSelectTab = {}, onProcessingClick = {}, onCanvas = {}, onBack = null,
                        modifier = Modifier.align(Alignment.TopCenter).graphicsLayer { translationY = offset },
                    )
                }
            }
        }
    }

    /** The heading a list scrolled to [index] sits under, computed the way the feed reports it. */
    private fun headingNow(tab: BrowseTab, documents: List<DocumentDto>, index: Int): FeedItem.Header? =
        headingAt(toRows(buildFeed(tab, documents, today, ZoneOffset.UTC), 390f, layout.mode, layout.featureEvery), index)

    @Test fun all() = paparazzi.snapshot { Screen(BrowseTab.ALL, all, total = 250) }

    @Test fun photos() = paparazzi.snapshot { Screen(BrowseTab.PHOTOS, photos, total = 168) }

    @Test fun videos() = paparazzi.snapshot { Screen(BrowseTab.VIDEOS, videos, total = 12) }

    @Test fun files() = paparazzi.snapshot { Screen(BrowseTab.FILES, files, total = 250) }

    @Test fun headerHalfHidden() = paparazzi.snapshot { HalfHiddenScreen() }

    @Test fun scrolledPhotos() = paparazzi.snapshot { Screen(BrowseTab.PHOTOS, photos, total = 168, scrolledTo = 3) }
}
