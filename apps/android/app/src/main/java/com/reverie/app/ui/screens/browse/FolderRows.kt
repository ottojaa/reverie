package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentCategory
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.settings.FolderView
import com.reverie.app.domain.contentsMeta
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.components.computeSections
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatDuration
import java.time.LocalDate
import java.time.ZoneId

/**
 * The line under a folder's name: what its row says, plus the days its photos span where it has no folders
 * of its own (the span covers only the folder's own documents). The root has no row, so its line counts what
 * is directly in it. Null until the folder, or the root's figures, are known.
 */
fun folderPageMeta(state: FolderState): String? {
    val contents = if (state.isRoot) rootMeta(state) else state.node?.let(::folderMeta)
    if (contents == null) return null
    val span = state.summary?.media_dates?.takeIf { state.children.isEmpty() }?.let(::daySpan)
    return listOfNotNull(contents, span).joinToString(" · ")
}

private fun rootMeta(state: FolderState): String? {
    val summary = state.summary ?: return null
    val documents = KindCountsDto(summary.image.count, summary.video.count, summary.file.count)
    return contentsMeta(state.children.size, documents)
}

/**
 * The document rows of a folder page, in the order the page's documents come: a row each in a list, or the
 * bands of one continuous grid packed by the user's grid setting.
 */
fun folderRows(state: FolderState, width: Float, layout: FeedLayout): List<FeedRow> {
    val documents = state.documents.documents
    return when (state.view) {
        null -> emptyList()
        FolderView.LIST -> documents.map { FeedRow.File(it) }
        FolderView.GRID -> computeSections(documents, width, layout.mode, layout.featureEvery).map { FeedRow.Band(it) }
    }
}

/**
 * The line under a document's name on a folder page: what it is, one fact about it, and the date a page that
 * lists [filter] goes by: "Photo · Suomenlinna · 14 Jul", "Video · 0:42 · 18 Jul", "PDF · 84 KB · 17 Dec 2025".
 */
fun folderRowMeta(doc: DocumentDto, filter: DocumentFilter, today: LocalDate, zone: ZoneId): String {
    val (type, fact) = when (doc.kind) {
        DocumentKind.IMAGE -> photoName(doc) to doc.city
        DocumentKind.VIDEO -> "Video" to doc.duration_seconds?.let(::formatDuration)
        DocumentKind.FILE -> fileTypeLabel(doc.mime_type, doc.original_filename) to formatBytes(doc.size_bytes)
    }
    val at = if (filter.isByDateTaken) timeTakenOf(doc, zone) else timeAddedOf(doc, zone)
    return listOfNotNull(type, fact, at?.let { shortWhen(it, today) }).joinToString(" · ")
}

private fun photoName(doc: DocumentDto): String =
    if (doc.document_category == DocumentCategory.SCREENSHOT) "Screenshot" else "Photo"
