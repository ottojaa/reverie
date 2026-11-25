package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.ScreenOrientation
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.TopTypeDto
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.theme.ThemeMode
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.ui.screens.browse.BrowseHeader
import com.reverie.app.ui.screens.browse.BrowseTitle
import com.reverie.app.ui.screens.browse.DashboardActions
import com.reverie.app.ui.screens.browse.DashboardBody
import com.reverie.app.ui.screens.browse.DashboardState
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedLayout
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.FileMenuItems
import com.reverie.app.ui.screens.browse.FeedList
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.collections.CollectionSection
import com.reverie.app.ui.screens.collections.CollectionsActions
import com.reverie.app.ui.screens.collections.CollectionsContent
import com.reverie.app.ui.screens.collections.CollectionsFixtures
import com.reverie.app.ui.screens.collections.RowMenuItems
import com.reverie.app.ui.screens.document.ViewerToolbar
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * The stars and the three places favourites are listed, as the Fav boards draw them. Every state renders
 * dark and light. Blurhashes stand in for thumbnails: a screenshot test has no network.
 */
class FavouritesScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val today = LocalDate.of(2026, 11, 25)
    private val zone = ZoneOffset.UTC
    private val fixtures = FavouriteFixtures

    private val unlocked = fixtures.private("d-open", locked = false)
    private val boardState = FavouritesState(items = fixtures.all)

    private fun both(state: String, device: DeviceConfig = DeviceConfig.PIXEL_5, content: @Composable () -> Unit) {
        CollectionsFixtures.warmBlurhashes()
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        listOf(ThemeMode.DARK to "dark", ThemeMode.LIGHT to "light").forEach { (mode, name) ->
            paparazzi.snapshot("${state}_$name") {
                // Inspection mode makes Coil draw the placeholder (the blurhash) instead of nothing.
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    ReverieTheme(themeMode = mode) { Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) { content() } }
                }
            }
        }
    }

    private fun wide(width: Int, height: Int) =
        DeviceConfig.PIXEL_5.copy(screenWidth = width, screenHeight = height, orientation = ScreenOrientation.LANDSCAPE)

    @Composable
    private fun Label(text: String) =
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))

    @Composable
    private fun Toolbar(label: String, favourites: FavouritesState, document: DocumentDto) {
        Label(label)
        ViewerToolbar(
            document = document, phase = InsightPhase.Idle, detailsOpen = false, menuOpen = false, onBack = {}, onTitleClick = {},
            onEdit = {}, onMenuToggle = {}, onRename = {}, favourites = favourites, documentId = document.id, onToggleStar = {},
        )
    }

    @Test fun viewerStar() = both("viewerStar") {
        val sunset = fixtures.sunset.document!!
        val long = fixtures.document("d-long", "Lease agreement – Kalevankatu 12, signed copy.pdf", "application/pdf", 1_800_000)
        Column {
            Toolbar("Not a favourite", fixtures.state(), sunset)
            Toolbar("A favourite", boardState, sunset)
            Toolbar("Favourites not loaded yet", FavouritesState(), long)
            Column(Modifier.padding(top = 32.dp).align(Alignment.CenterHorizontally), horizontalAlignment = Alignment.CenterHorizontally) {
                FavouritePill(FavouriteController.ADDED)
                FavouritePill(FavouriteController.REMOVED)
                FavouritePill(FavouriteController.ADD_FAILED)
            }
        }
    }

    @Composable
    private fun Menu(label: String, items: @Composable () -> Unit) {
        Label(label)
        Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceContainer, shadowElevation = 6.dp, modifier = Modifier.padding(start = 16.dp).width(220.dp)) {
            Column(Modifier.padding(vertical = 4.dp)) { items() }
        }
    }

    // A popup is a window of its own that a screenshot test does not draw, so the items are drawn in place.
    @Test fun menus() = both("menus", DeviceConfig.PIXEL_5.copy(screenHeight = 2800)) {
        val file = fixtures.invoice.document!!
        Column {
            listOf(false, true).forEach { starred ->
                Menu(if (starred) "Folder menu, a favourite" else "Collection menu") {
                    val onNewFolder: (() -> Unit)? = if (starred) null else ({})
                    RowMenuItems(isStarred = starred, onToggleStar = {}, isPrivate = false, onNewFolder = onNewFolder, onEdit = {}, onTogglePrivate = {}, onDelete = {})
                }
            }
            listOf(false, true).forEach { starred ->
                Menu(if (starred) "File menu, a favourite" else "File menu") {
                    FileMenuItems(file, RowActions(selected = { false }, onClick = {}, onLongClick = {}, starred = { starred }))
                }
            }
        }
    }

    private fun media(id: String, mime: String, day: Int, seconds: Double? = null) =
        fixtures.document(id, "$id.${mime.substringAfter('/')}", mime, 2_400_000, FavouriteFixtures.HASH)
            .copy(duration_seconds = seconds, taken_at = "2026-11-%02dT10:00:00Z".format(day), created_at = "2026-11-%02dT10:00:00Z".format(day))

    @Composable
    private fun Feed(source: FeedSource, documents: List<DocumentDto>, starred: Set<String>, modifier: Modifier) {
        FeedList(
            source = source, documents = documents, hasMore = false, listState = rememberLazyListState(), contentPadding = PaddingValues(0.dp),
            layout = FeedLayout(GridLayoutMode.MOSAIC, featureEvery = 8, today = today, zone = zone),
            actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}, starred = { it.id in starred }),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, modifier = modifier,
        )
    }

    @Test fun badgesMedia() = both("badgesMedia") {
        val photos = (1..7).map { media("p$it", "image/jpeg", 24) }
        val videos = (1..3).map { media("v$it", "video/mp4", 23, seconds = 74.0 * it) }
        Column {
            Label("Photos: the first and fourth are favourites")
            Feed(FeedSource.PHOTOS, photos, setOf("p1", "p4"), Modifier.height(330.dp))
            Label("Videos: the first and second are favourites")
            Feed(FeedSource.VIDEOS, videos, setOf("v1", "v2"), Modifier.height(340.dp))
        }
    }

    private fun file(id: String, name: String, mime: String) =
        fixtures.document(id, name, mime, 219_000).copy(created_at = "2026-11-24T10:00:00Z", thumbnail_status = com.reverie.app.data.api.model.JobStatus.SKIPPED)

    private val files = listOf(
        file("d-invoice", "invoice-march.pdf", "application/pdf"),
        file("d-long", "Lease agreement – Kalevankatu 12, signed copy.pdf", "application/pdf"),
        file("d-notes", "notes.md", "text/markdown"),
    )

    @Test fun badgesRows() = both("badgesRows", DeviceConfig.PIXEL_5.copy(screenHeight = 2900)) {
        Column {
            Label("File rows: the first two are favourites")
            Feed(FeedSource.FILES, files, setOf("d-invoice", "d-long"), Modifier.height(270.dp))
            Label("Collections: Travel, Lisbon and Japan are favourites")
            CollectionSection(CollectionsFixtures.travel, CollectionsFixtures.covers, expanded = true, actions = CollectionsActions(), modifier = Modifier.padding(horizontal = 16.dp), starredIds = setOf("c-travel", "f-lisbon", "f-japan"))
        }
    }

    private fun collections(vararg items: FavouriteDto) = CollectionsFixtures.state(CollectionsFixtures.travel, CollectionsFixtures.code)
        .copy(favourites = fixtures.state(*items))

    @Test fun shelf() = both("shelf") { CollectionsContent(collections(*fixtures.all.toTypedArray()), CollectionsActions()) }

    // Wide enough to see every card of the shelf at once, an open private one included.
    @Test fun shelfCards() = both("shelfCards", wide(width = 3300, height = 700)) {
        FavouritesShelf(listOf(fixtures.portugal, fixtures.code, fixtures.invoice, fixtures.sunset, fixtures.builds, fixtures.secret, unlocked, fixtures.notes), onOpen = {}, onSeeAll = {})
    }

    private val summary = DocumentSummaryDto(
        image = KindTotalsDto(38, 210_000_000),
        video = KindTotalsDto(19, 1_400_000_000),
        file = FileTotalsDto(191, 2_900_000_000, listOf(TopTypeDto("apk", 120), TopTypeDto("zip", 31))),
    )

    @Composable
    private fun Dashboard(favourites: List<FavouriteDto>, documents: List<DocumentDto>) {
        Column {
            BrowseHeader(title = BrowseTitle("My Files", if (documents.isEmpty()) "0 documents" else "248 documents"), processingCount = 0, onProcessingClick = {}, onBack = null)
            Box(Modifier.weight(1f)) {
                DashboardBody(
                    state = DashboardState(
                        summary = summary.takeIf { documents.isNotEmpty() },
                        photoPreview = (1..4).map { media("s$it", "image/jpeg", 20) },
                        videoPreview = media("preview", "video/mp4", 6, 74.0),
                        recent = FeedState(FeedDocuments(documents, total = documents.size, hasMore = false, fetched = true)),
                    ),
                    listState = rememberLazyListState(), contentPadding = PaddingValues(bottom = 24.dp), today = today, zone = zone,
                    actions = DashboardActions(onOpenKind = {}, recent = RowActions(selected = { false }, onClick = {}, onLongClick = {}, starred = { it.id == "d-invoice" })),
                    focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null, onUpload = {},
                    favourites = favourites,
                )
            }
        }
    }

    @Test fun dashboardStrip() = both("dashboardStrip") { Dashboard(fixtures.all, files) }

    @Test fun dashboardStripEmptyLibrary() = both("dashboardStripEmptyLibrary") { Dashboard(listOf(fixtures.portugal, fixtures.secret), emptyList()) }

    @Test fun stripTiles() = both("stripTiles", wide(width = 2300, height = 450)) {
        FavouritesStrip(fixtures.all + unlocked, onOpen = {}, onSeeAll = {})
    }

    private fun screen(name: String, state: FavouritesState, filter: FavouriteFilter, device: DeviceConfig = DeviceConfig.PIXEL_5) =
        both(name, device) { FavouritesContent(state, filter, FavouritesActions()) }

    @Test fun screenAll() = screen("screenAll", boardState, FavouriteFilter.ALL, DeviceConfig.PIXEL_5.copy(screenHeight = 2700))

    @Test fun screenFolders() = screen("screenFolders", boardState, FavouriteFilter.FOLDERS)

    @Test fun screenFiles() = screen("screenFiles", boardState, FavouriteFilter.FILES, DeviceConfig.PIXEL_5.copy(screenHeight = 2700))

    @Test fun screenEmpty() = screen("screenEmpty", fixtures.state(), FavouriteFilter.ALL)

    @Test fun screenNotLoaded() = screen("screenNotLoaded", FavouritesState(), FavouriteFilter.ALL)

    // A narrow phone at a large font size, with long names and more than a screenful.
    @Test fun screenNarrow() {
        val long = fixtures.file(
            fixtures.document("d-long", "Lease agreement – Kalevankatu 12, signed copy.pdf", "application/pdf", 18_400_000),
            "Household paperwork", "Apartment contracts and receipts",
        )
        val many = listOf(long, unlocked) + fixtures.all
        screen("screenNarrow", FavouritesState(items = many), FavouriteFilter.ALL, DeviceConfig.PIXEL_5.copy(screenWidth = 880, screenHeight = 1750, fontScale = 1.3f))
    }

    @Test fun shelfNarrow() = both("shelfNarrow", DeviceConfig.PIXEL_5.copy(screenWidth = 880, screenHeight = 1750, fontScale = 1.3f)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val long = fixtures.folder("f-long", "Household paperwork and receipts 2025", "f-iceland", "Apartment contracts")
            FavouritesShelf(listOf(long) + fixtures.all, onOpen = {}, onSeeAll = {})
            FavouritesStrip(listOf(long) + fixtures.all, onOpen = {}, onSeeAll = {})
        }
    }
}
