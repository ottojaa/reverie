package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteLocationDto
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.ui.screens.destination.node

/** Some of each favourite: folders at the top and further down, a photo, a video, files and a private item. */
internal object FavouriteFixtures {
    private const val STAMP = "2026-11-01T00:00:00.000Z"
    const val HASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj"

    fun document(id: String, name: String, mime: String, bytes: Long, hash: String? = null) = DocumentDto(
        id = id, file_path = "p", file_hash = "h", original_filename = name, mime_type = mime, size_bytes = bytes,
        width = 4000, height = 3000, thumbnail_blurhash = hash, ocr_status = JobStatus.COMPLETE,
        thumbnail_status = JobStatus.COMPLETE, llm_status = JobStatus.COMPLETE, is_private = false,
        created_at = STAMP, updated_at = STAMP,
    )

    private fun path(vararg names: String) = names.map { FavouriteLocationDto("id-$it", it) }

    fun file(document: DocumentDto, vararg location: String) = FavouriteDto(
        FavouriteType.DOCUMENT, document.id, STAMP, isPrivate = false, location = path(*location), document = document,
    )

    /** A folder as the favourites answer carries it: without what it holds, which only the tree says. */
    fun folder(id: String, name: String, vararg location: String) = FavouriteDto(
        FavouriteType.FOLDER, id, STAMP, isPrivate = false, location = path(*location),
        folder = node(id).copy(name = name),
    )

    fun private(id: String, locked: Boolean, type: FavouriteType = FavouriteType.DOCUMENT) = FavouriteDto(
        type, id, STAMP, isPrivate = true, locked = locked, lockId = "lock-1",
    )

    val portugal = folder("f-portugal", "Portugal - 2025", "Photos")
    val invoice = file(document("d-invoice", "invoice-march.pdf", "application/pdf", 219_000), "Other", "Misc")
    val builds = folder("f-builds", "Builds", "App Releases")
    val sunset = file(document("d-sunset", "sunset.jpg", "image/jpeg", 3_250_000, HASH), "Photos", "Portugal - 2025")
    val code = folder("f-code", "Code")
    val clip = file(
        document("d-clip", "tram-28.mp4", "video/mp4", 48_000_000, HASH).copy(duration_seconds = 42.0), "Photos",
    )
    val notes = file(document("d-notes", "notes.md", "text/markdown", 8_200))
    val secret = private("d-secret", locked = true)

    val all = listOf(portugal, invoice, builds, sunset, code, clip, notes, secret)

    fun state(vararg items: FavouriteDto) = FavouritesState(items = items.toList())

    val loaded = FavouritesState(items = all)
}
