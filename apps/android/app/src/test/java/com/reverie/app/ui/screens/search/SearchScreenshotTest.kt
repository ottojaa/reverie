package com.reverie.app.ui.screens.search

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.data.api.model.CollectionSearchResult
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.domain.CachedFolders
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.BLURHASHES
import com.reverie.app.ui.photoCover
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.manage.PickedTopBar
import com.reverie.app.ui.screens.manage.RowSelection
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test

/** Searching inside a folder or one kind of document, dark and light: media as a grid, other pages as a list. */
class SearchScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val portugal = node("portugal").copy(name = "Portugal – 2025", kind_counts = KindCountsDto(image = 214))
    private val alfama = node("alfama", parent = "portugal")
        .copy(name = "Lisbon – Alfama, Mouraria and the old tram routes", kind_counts = KindCountsDto(image = 48, file = 3))

    private val folders = CachedFolders(
        byId = listOf(portugal, alfama).associateBy { it.id },
        covers = mapOf("alfama" to photoCover("alfama")),
    )

    private fun hit(index: Int, name: String, mime: String = "image/jpeg", path: String? = "/Travel/Portugal – 2025") =
        DocumentSearchResult(
            document_id = "hit$index", display_name = name, filename = name, uploaded_at = "2025-08-23T10:00:00.000Z",
            mime_type = mime, format = name.substringAfterLast('.'), has_text = false, size_bytes = 2_400_000,
            folder_path = path, blurhash = BLURHASHES[index % BLURHASHES.size].takeIf { mime != "application/pdf" },
            duration_seconds = 42.0.takeIf { mime == "video/mp4" },
        )

    private val page = SearchUiState(
        query = "lisbon",
        freeText = "lisbon",
        scope = SearchScope.Folder("portugal"),
        folders = folders,
    )

    @Test fun scopedPhotos() {
        val photos = (0 until 9).map { hit(it, "IMG_20250823_${1000 + it}.jpg", if (it == 4) "video/mp4" else "image/jpeg") }
        val state = page.copy(results = photos, total = photos.size, viewMode = ViewMode.GRID)

        paparazzi.snapshotThemes("scopedPhotos") { SearchBody(state, SearchActions()) }
    }

    @Test fun scopedList() {
        val hits = listOf(
            CollectionSearchResult(id = "alfama", name = alfama.name, path = "/Travel/Portugal – 2025/${alfama.name}"),
            hit(1, "Lisbon apartment booking confirmation – Rua dos Remédios 74.pdf", "application/pdf"),
            hit(2, "Lisbon – view from Miradouro da Senhora do Monte at sunset.jpg"),
        )
        val state = page.copy(results = hits, total = hits.size)

        paparazzi.snapshotThemes("scopedList") { SearchBody(state, SearchActions()) }
    }

    private fun ofKind(kind: DocumentKind, hits: List<DocumentSearchResult>) = page.copy(
        scope = SearchScope.Kind(kind),
        results = hits,
        total = hits.size,
        viewMode = if (kind == DocumentKind.FILE) ViewMode.LIST else ViewMode.GRID,
    )

    @Test fun photoScope() {
        val state = ofKind(DocumentKind.IMAGE, (0 until 9).map { hit(it, "IMG_20250823_${1000 + it}.jpg") })

        paparazzi.snapshotThemes("photoScope") { SearchBody(state, SearchActions()) }
    }

    @Test fun videoScope() {
        val state = ofKind(DocumentKind.VIDEO, (0 until 5).map { hit(it, "VID_20250823_${1000 + it}.mp4", "video/mp4") })

        paparazzi.snapshotThemes("videoScope") { SearchBody(state, SearchActions()) }
    }

    @Test fun fileScope() {
        val hits = listOf(
            hit(1, "Lisbon apartment booking confirmation – Rua dos Remédios 74.pdf", "application/pdf"),
            hit(2, "Lisbon tram and metro day tickets.pdf", "application/pdf"),
            hit(3, "Lisbon packing list.txt", "text/plain"),
        )

        paparazzi.snapshotThemes("fileScope") { SearchBody(ofKind(DocumentKind.FILE, hits), SearchActions()) }
    }

    @Composable
    private fun Selected(state: SearchUiState, ids: Set<String>) = Box(Modifier.fillMaxSize()) {
        SearchBody(state, SearchActions(selection = RowSelection(ids)))
        PickedTopBar(state.picked(ids), isStarred = false, canDownload = false, onClose = {}, onPick = {})
    }

    @Test fun selectedPhotos() {
        val photos = (0 until 9).map { hit(it, "IMG_20250823_${1000 + it}.jpg") }
        val state = page.copy(results = photos, total = photos.size, viewMode = ViewMode.GRID)

        paparazzi.snapshotThemes("selectedPhotos") { Selected(state, setOf("hit0", "hit4")) }
    }

    @Test fun selectedList() {
        val hits = listOf(
            CollectionSearchResult(id = "alfama", name = alfama.name, path = "/Travel/Portugal – 2025/${alfama.name}"),
            hit(1, "Lisbon apartment booking confirmation – Rua dos Remédios 74.pdf", "application/pdf"),
            hit(2, "Lisbon – view from Miradouro da Senhora do Monte at sunset.jpg"),
        )
        val state = page.copy(results = hits, total = hits.size)

        paparazzi.snapshotThemes("selectedList") { Selected(state, setOf("alfama", "hit1")) }
    }

    private val everyKind: List<DocumentSearchResult> = listOf(
        hit(1, "Lisbon – view from Miradouro da Senhora do Monte.jpg"),
        hit(2, "VID_20250823_1015.mp4", "video/mp4"),
        hit(3, "Lisbon apartment booking confirmation.pdf", "application/pdf").copy(blurhash = BLURHASHES[0]),
        hit(4, "lisbon-offline-maps.apk", "application/vnd.android.package-archive").copy(blurhash = null),
        hit(5, "lisbon-originals.zip", "application/zip").copy(blurhash = null),
        hit(6, "lisbon-packing-list.md", "text/markdown").copy(blurhash = null),
        hit(7, "lisbon-trip-budget.xlsx", "application/vnd.ms-excel").copy(blurhash = BLURHASHES[1]),
        // Rendered by the server, but a text file is drawn as its type.
        hit(8, "lisbon-expenses.csv", "text/csv"),
    )

    @Test fun typesList() {
        val state = page.copy(results = everyKind, total = everyKind.size, viewMode = ViewMode.LIST)

        paparazzi.snapshotThemes("typesList") { SearchBody(state, SearchActions()) }
    }

    @Test fun typesGrid() {
        val state = page.copy(results = everyKind, total = everyKind.size, viewMode = ViewMode.GRID)

        paparazzi.snapshotThemes("typesGrid") { SearchBody(state, SearchActions()) }
    }
}
