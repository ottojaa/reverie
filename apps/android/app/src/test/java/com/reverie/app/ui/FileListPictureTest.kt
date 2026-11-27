package com.reverie.app.ui

import android.content.Context
import android.graphics.drawable.ColorDrawable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import coil.Coil
import coil.ImageLoader
import coil.decode.DataSource
import coil.intercept.Interceptor
import coil.request.CachePolicy
import coil.request.ImageRequest
import coil.request.ImageResult
import coil.request.SuccessResult
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.api.model.ThumbnailUrls
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.PhotoResultTile
import com.reverie.app.ui.components.SearchResultRow
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedRow
import com.reverie.app.ui.screens.browse.FeedRowView
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.GroupKind
import com.reverie.app.ui.screens.browse.ProcessingSheetContent
import com.reverie.app.ui.screens.browse.ProcessingSheetState
import com.reverie.app.ui.screens.browse.RecentEntry
import com.reverie.app.ui.screens.browse.RecentRow
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.favourites.FavouriteFixtures
import com.reverie.app.ui.screens.favourites.FavouritesActions
import com.reverie.app.ui.screens.favourites.FileFavourite
import com.reverie.app.ui.screens.library.LibraryDay
import com.reverie.app.ui.screens.library.RecentlyAdded
import com.reverie.app.ui.screens.trash.TrashItem
import com.reverie.app.ui.screens.trash.TrashRow
import com.reverie.app.ui.screens.trash.trashedFile
import com.reverie.app.ui.theme.ReverieTheme
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Lists outside a folder page draw a file as folder pages do: its type, or the server's picture of it under
 * a badge of its type, loaded under the same disk cache rule as before on each screen.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class FileListPictureTest {
    @get:Rule
    val compose = createComposeRule()

    private val requests = CopyOnWriteArrayList<ImageRequest>()
    private val today = LocalDate.of(2026, 11, 25)
    private val actions = RowActions(selected = { false }, onClick = {}, onLongClick = {})
    private val apk = doc("apk", "application/vnd.android.package-archive", name = "app-release.apk")
    private val pdf = doc("pdf", "application/pdf", name = "lease.pdf").copy(thumbnail_blurhash = FavouriteFixtures.HASH)
    private val apkHit = DocumentSearchResult(
        document_id = "hit", display_name = "app-release.apk", filename = "app-release.apk",
        uploaded_at = "2026-11-24T10:00:00Z", mime_type = apk.mime_type, format = "apk", has_text = false, size_bytes = 1,
    )

    @Before fun setUp() {
        val loads = object : Interceptor {
            override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
                requests += chain.request
                return SuccessResult(ColorDrawable(0), chain.request, DataSource.NETWORK)
            }
        }
        val context = ApplicationProvider.getApplicationContext<Context>()
        Coil.setImageLoader(ImageLoader.Builder(context).components { add(loads) }.build())
    }

    @After fun tearDown() = Coil.reset()

    private fun show(content: @Composable () -> Unit) = compose.setContent { ReverieTheme { Column { content() } } }

    private fun assertTypeTiles(label: String, count: Int = 1) =
        compose.onAllNodesWithTag("file-tile:$label", useUnmergedTree = true).assertCountEquals(count)

    private fun awaitRequest(): ImageRequest {
        compose.waitUntil(5_000) { requests.isNotEmpty() }
        return requests.single()
    }

    @Test fun `a Files view row shows an APK as its type`() {
        show { FeedRowView(FeedRow.File(apk), actions, today, ZoneOffset.UTC) }

        assertTypeTiles("APK")
    }

    @Test fun `a recent row and a stack of versions show their type`() {
        val older = apk.copy(id = "older")
        show {
            FeedRowView(FeedRow.Added(RecentEntry.Row(RecentRow.Single(apk))), actions, today, ZoneOffset.UTC)
            val stack = RecentRow.Group(GroupKind.STACK, listOf(older, older.copy(id = "oldest")))
            FeedRowView(FeedRow.Added(RecentEntry.Row(stack)), actions, today, ZoneOffset.UTC)
        }

        assertTypeTiles("APK", count = 2)
    }

    private fun showProcessing(document: DocumentDto) = show {
        val state = ProcessingSheetState(rows = listOf(document.copy(llm_status = JobStatus.PROCESSING)), total = 1, isLoading = false)
        ProcessingSheetContent(state, onOpenDocument = {}, onLoadMore = {})
    }

    @Test fun `a processing row shows an APK as its type`() {
        showProcessing(apk)

        assertTypeTiles("APK")
    }

    @Test fun `a processing PDF shows its small picture under its badge`() {
        showProcessing(pdf)

        compose.onNodeWithContentDescription("PDF", useUnmergedTree = true).assertExists()
        assertEquals(ThumbnailRef(pdf.id, ThumbnailSize.SM), awaitRequest().data)
    }

    @Test fun `the recently added tiles show a file's type`() {
        show {
            val recent = FeedState(FeedDocuments(listOf(apk), total = 1, fetched = true))
            RecentlyAdded(recent, actions, LibraryDay(today, ZoneOffset.UTC), rememberLazyListState(), onLoadMore = {})
        }

        assertTypeTiles("APK")
    }

    @Test fun `a search hit shows its type in the list and in the grid`() {
        show {
            SearchResultRow(apkHit, onClick = {}, onLongClick = {})
            PhotoResultTile(apkHit, onClick = {}, modifier = Modifier.size(120.dp))
        }

        assertTypeTiles("APK", count = 2)
    }

    @Test fun `a favourite PDF shows its picture under its badge and writes nothing to disk`() {
        show { FileFavourite(FavouriteFixtures.file(pdf), FavouritesActions({}, {}, {})) }

        compose.onNodeWithContentDescription("PDF", useUnmergedTree = true).assertExists()
        assertEquals(CachePolicy.READ_ONLY, awaitRequest().diskCachePolicy)
    }

    @Test fun `a trashed PDF shows its picture under its badge, loaded by its signed address and never kept`() {
        val address = "https://example.test/signed"
        val file = trashedFile("lease", thumbnails = ThumbnailUrls(address, address, address))
        show { TrashRow(TrashItem.Document(file), Instant.parse("2026-11-01T12:00:00Z"), onClick = {}, onLongClick = {}) }

        compose.onNodeWithContentDescription("PDF", useUnmergedTree = true).assertExists()
        val request = awaitRequest()
        assertEquals(address, request.data)
        assertEquals(CachePolicy.DISABLED, request.diskCachePolicy)
    }

    @Test fun `a trashed APK shows its type`() {
        val file = trashedFile("app-release", name = "app-release.apk").copy(mime_type = apk.mime_type)
        show { TrashRow(TrashItem.Document(file), Instant.parse("2026-11-01T12:00:00Z"), onClick = {}, onLongClick = {}) }

        assertTypeTiles("APK")
    }
}
