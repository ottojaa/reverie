package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.BLURHASHES
import com.reverie.app.ui.components.AccountButton
import com.reverie.app.ui.navigation.BottomPill
import com.reverie.app.ui.navigation.Tab
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/** The Photos tab: the photos under day headings, edge to edge, dark and light. */
class PhotosTabScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val layout = FeedLayout(GridLayoutMode.UNIFORM, featureEvery = 8, today = LocalDate.of(2026, 11, 23), zone = ZoneOffset.UTC)

    private fun photo(index: Int, day: String) = DocumentDto(
        id = "m$index", file_path = "/m$index", file_hash = "h$index",
        original_filename = "PXL_$index.jpg", mime_type = "image/jpeg",
        size_bytes = 2_400_000, thumbnail_blurhash = BLURHASHES[index % BLURHASHES.size],
        ocr_status = JobStatus.COMPLETE, thumbnail_status = JobStatus.COMPLETE, llm_status = JobStatus.COMPLETE,
        is_private = false, taken_at = "${day}T12:${(59 - index).toString().padStart(2, '0')}:00.000Z",
        created_at = "${day}T12:00:00.000Z", updated_at = "${day}T12:00:00.000Z",
    )

    private val today = (0..1).map { photo(it, "2026-11-23") }
    private val yesterday = (2..4).map { photo(it, "2026-11-22") }
    private val earlier = (5..16).map { photo(it, "2026-11-06") }

    @Composable
    private fun Page(documents: List<DocumentDto>) = Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            BrowseHeader(
                title = BrowseTitle(FeedSource.PHOTOS.title, FeedSource.PHOTOS.subtitle(PHOTOS_IN_LIBRARY).orEmpty()),
                processingCount = 0, onProcessingClick = {}, onBack = null,
                actions = {
                    IconButton(onClick = {}) { Icon(Icons.Outlined.Search, contentDescription = null) }
                    AccountButton(BackupStatus.Complete, onClick = {})
                },
            )
            Box(Modifier.weight(1f)) {
                FeedList(
                    source = FeedSource.PHOTOS, documents = documents, hasMore = false, listState = rememberLazyListState(),
                    contentPadding = PaddingValues(bottom = 96.dp), layout = layout,
                    actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}, starred = { it.id == "m2" }),
                    focusedId = null, onFocusConsumed = {}, onLoadMore = {},
                )
            }
        }
        BottomPill(Tab.PHOTOS, onSelect = {}, showSearch = false, onSearch = {}, Modifier.align(Alignment.BottomCenter))
    }

    @Test fun photosTab() = paparazzi.snapshotThemes("photosTab") { Page(today + yesterday + earlier) }

    private companion object {
        const val PHOTOS_IN_LIBRARY = 248
    }
}
