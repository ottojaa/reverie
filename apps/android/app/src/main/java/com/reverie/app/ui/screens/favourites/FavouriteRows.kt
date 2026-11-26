package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.kind
import com.reverie.app.domain.counted
import com.reverie.app.ui.components.computeUniformSections

/**
 * The favourites as the screen's three sections, each in the order given. A private document arrives with
 * nothing that says what it is, so it is listed with the files.
 */
class FavouriteSections(items: List<FavouriteDto>) {
    val folders: List<FavouriteDto> = items.filter { it.type == FavouriteType.FOLDER }
    private val documents = items - folders.toSet()
    val media: List<FavouriteDto> = documents.filter { it.document != null && it.document.kind != DocumentKind.FILE }
    val files: List<FavouriteDto> = documents - media.toSet()

    /** The section a favourite document is listed in. */
    fun sectionOf(item: FavouriteDto): List<FavouriteDto> = if (media.any { it.id == item.id }) media else files

    /** "3 folders · 1 video · 1 file", naming only what there is. */
    fun countLine(): String {
        val (videos, photos) = media.partition { it.document?.kind == DocumentKind.VIDEO }
        return listOf(folders to "folder", photos to "photo", videos to "video", files to "file")
            .filter { (items, _) -> items.isNotEmpty() }
            .joinToString(" · ") { (items, noun) -> counted(items.size, noun) }
    }
}

/** One item of the screen's list. */
sealed interface FavouriteRow {
    val key: String

    data class Heading(val title: String) : FavouriteRow {
        override val key = "heading:$title"
    }

    data class Folder(val item: FavouriteDto) : FavouriteRow {
        override val key = "folder:" + item.id
    }

    /** One row of the photo and video grid, in square cells [cell] dp wide. */
    data class Tiles(val items: List<FavouriteDto>, val cell: Float) : FavouriteRow {
        override val key = "tiles:" + items.first().id
    }

    data class File(val item: FavouriteDto) : FavouriteRow {
        override val key = "file:" + item.id
    }

    /** Whether this row shows the document [id]. */
    fun shows(id: String): Boolean = when (this) {
        is Tiles -> items.any { it.id == id }
        is File -> item.id == id
        is Heading, is Folder -> false
    }
}

/** The screen's list for a grid [width] dp wide: each section that holds something, under its name. */
fun favouriteRows(sections: FavouriteSections, width: Float): List<FavouriteRow> =
    section("Folders", sections.folders.map(FavouriteRow::Folder)) +
        section("Photos and videos", tileRows(sections.media, width)) +
        section("Files", sections.files.map(FavouriteRow::File))

private fun section(title: String, rows: List<FavouriteRow>): List<FavouriteRow> =
    if (rows.isEmpty()) emptyList() else listOf(FavouriteRow.Heading(title)) + rows

private fun tileRows(media: List<FavouriteDto>, width: Float): List<FavouriteRow.Tiles> {
    val byId = media.associateBy { it.id }
    return computeUniformSections(media.mapNotNull { it.document }, width).map { band ->
        FavouriteRow.Tiles(band.tiles.map { byId.getValue(it.doc.id) }, band.tiles.first().width)
    }
}
