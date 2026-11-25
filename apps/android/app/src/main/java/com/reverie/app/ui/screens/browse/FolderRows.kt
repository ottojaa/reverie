package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.domain.folderMeta

/**
 * The line under a folder's name: what its row says, plus the days its photos span where it has no folders
 * of its own (the span covers only the folder's own documents). Null until the folder is known.
 */
fun folderPageMeta(state: FolderState): String? {
    val folder = state.node ?: return null
    val span = state.summary?.media_dates?.takeIf { folder.children.isEmpty() }?.let(::daySpan)
    return listOfNotNull(folderMeta(folder), span).joinToString(" · ")
}

/**
 * The document rows of a folder page: the photos and videos by the day taken, then the other files by the
 * day added. Each section is named only where the folder holds both kinds.
 */
fun folderRows(state: FolderState, width: Float, layout: FeedLayout): List<FeedRow> {
    val files = state.files?.documents.orEmpty()
    val hasMedia = state.media.documents.isNotEmpty() ||
        state.summary?.let { it.image.count + it.video.count > 0 } == true
    val hasFiles = files.isNotEmpty() || state.summary?.let { it.file.count > 0 } == true
    val isTitled = hasMedia && hasFiles
    return sectionRows("Photos and videos".takeIf { isTitled }, DocumentFilter.MEDIA, state.media, width, layout) +
        sectionRows("Files".takeIf { isTitled }, DocumentFilter.FILES, state.files, width, layout)
}

private fun sectionRows(
    title: String?,
    filter: DocumentFilter,
    section: FeedDocuments?,
    width: Float,
    layout: FeedLayout,
): List<FeedRow> {
    val documents = section?.documents.orEmpty()
    if (documents.isEmpty()) return emptyList()
    val feed = buildFeed(filter, documents, layout.today, layout.zone)
    // Both sections can have the same day, and a list's keys must differ.
    val days = toRows(feed, width, layout.mode, layout.featureEvery).map { row ->
        if (row is FeedRow.Heading) row.copy(key = filter.name + ":" + row.key) else row
    }
    return listOfNotNull(title?.let { FeedRow.Section(it) }) + days
}
