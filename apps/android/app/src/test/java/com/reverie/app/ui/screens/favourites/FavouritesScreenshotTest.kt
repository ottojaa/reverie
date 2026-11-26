package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.domain.CachedFolders
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.ui.BLURHASHES
import com.reverie.app.ui.navigation.BottomPill
import com.reverie.app.ui.navigation.Tab
import com.reverie.app.ui.photoCover
import com.reverie.app.ui.screens.browse.FeedLayout
import com.reverie.app.ui.screens.browse.FeedList
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.document.ViewerToolbar
import com.reverie.app.ui.screens.manage.PickedTopBar
import com.reverie.app.ui.screens.manage.RowSelection
import com.reverie.app.ui.snapshotThemes
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Rule
import org.junit.Test

/**
 * The Favourites screen and the stars that lead to it, dark and light. Blurhashes stand in for thumbnails:
 * a screenshot test has no network.
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
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshotThemes(state, content)
    }

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

    @Test fun badgesRows() = both("badgesRows") {
        Column {
            Label("File rows: the first two are favourites")
            Feed(FeedSource.FILES, files, setOf("d-invoice", "d-long"), Modifier.height(270.dp))
        }
    }

    private fun tree(id: String, name: String, counts: KindCountsDto, folders: Int = 0) =
        node(id, children = (1..folders).map { node("$id-$it", parent = id) }).copy(name = name, kind_counts = counts)

    private val coding = tree("f-coding", "Coding", KindCountsDto(file = 14), folders = 1)
    private val photos = tree("f-photos", "Photos", KindCountsDto(image = 27), folders = 5)
    private val portugal = tree("f-portugal", "Portugal - 2025", KindCountsDto(image = 25))

    private val folders = CachedFolders(
        byId = listOf(coding, photos, portugal).associateBy { it.id },
        covers = listOf(coding, photos, portugal).associate { it.id to photoCover(it.id) },
    )

    private val folderItems = listOf(
        fixtures.folder(coding.id, coding.name),
        fixtures.folder(photos.id, photos.name),
        fixtures.folder(portugal.id, portugal.name, "Photos"),
    )

    private val recording = fixtures.file(
        fixtures.document("d-record", "Record_2026-11-24-00-14-04.mp4", "video/mp4", 4_100_000, FavouriteFixtures.HASH)
            .copy(duration_seconds = 12.0),
    )
    private val archive = fixtures.file(
        fixtures.document("d-zip", "lunamux-install.zip", "application/zip", 18_000_000), "Coding", "Code",
    )

    private val shots = BLURHASHES.mapIndexed { index, hash ->
        fixtures.file(fixtures.document("d-shot$index", "IMG_$index.jpg", "image/jpeg", 2_000_000, hash))
    }

    private fun screen(name: String, state: FavouritesState, device: DeviceConfig = DeviceConfig.PIXEL_5) =
        both(name, device) { Page(state) }

    /** The screen over the pill it shows in the app. */
    @Composable
    private fun Page(state: FavouritesState, selected: Set<String> = emptySet()) {
        Box(Modifier.fillMaxSize()) {
            FavouritesContent(state, folders, FavouritesActions({}, {}, {}, selection = RowSelection(selected)))
            BottomPill(Tab.LIBRARY, onSelect = {}, showSearch = true, onSearch = {}, Modifier.align(Alignment.BottomCenter))
            val picked = pickFavourites(selected, state.visible, folders)
            if (!picked.isEmpty) PickedTopBar(picked, isStarred = true, canDownload = false, onClose = {}, onPick = {})
        }
    }

    @Test fun screenBoard() = screen("screenBoard", FavouritesState(items = folderItems + recording + archive))

    @Test fun screenAll() = screen(
        "screenAll",
        FavouritesState(items = folderItems + shots + recording + archive + fixtures.invoice + fixtures.secret + unlocked),
        DeviceConfig.PIXEL_5.copy(screenHeight = 2900),
    )

    // One of each kind of favourite is selected; the private one keeps only the star in the bar.
    @Test fun screenSelection() = both("screenSelection") {
        val items = folderItems + shots.take(3) + recording + archive + fixtures.secret
        Page(FavouritesState(items = items), setOf(coding.id, shots.first().id, archive.id))
    }

    @Test fun screenSelectionLocked() = both("screenSelectionLocked") {
        Page(FavouritesState(items = folderItems + fixtures.secret), setOf(fixtures.secret.id))
    }

    @Test fun screenFolders() = screen("screenFolders", FavouritesState(items = folderItems))

    @Test fun screenFiles() = screen("screenFiles", fixtures.state(archive, fixtures.invoice, fixtures.notes))

    @Test fun screenEmpty() = screen("screenEmpty", fixtures.state())

    @Test fun screenNotLoaded() = screen("screenNotLoaded", FavouritesState())

    // A narrow phone at a large font size, with long names, folders the tree does not hold and a private folder.
    @Test fun screenNarrow() {
        val long = fixtures.file(
            fixtures.document("d-long", "Lease agreement – Kalevankatu 12, signed copy.pdf", "application/pdf", 18_400_000),
            "Household paperwork", "Apartment contracts and receipts",
        )
        val uncached = fixtures.folder("f-long", "Household paperwork and receipts 2025", "Apartment contracts")
        val vault = fixtures.private("f-vault", locked = true, type = FavouriteType.FOLDER)
        val items = listOf(folderItems[1], uncached, vault, recording, long, unlocked)
        screen(
            "screenNarrow", FavouritesState(items = items),
            DeviceConfig.PIXEL_5.copy(screenWidth = 880, screenHeight = 2600, fontScale = 1.3f),
        )
    }
}
