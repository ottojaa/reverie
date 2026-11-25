package com.reverie.app.ui.screens.browse

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.mediaAspectOrNull
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.viewer.isImageDocument
import com.reverie.app.ui.screens.viewer.isVideoDocument
import java.time.LocalDate

/**
 * Today's date, taken again whenever the screen comes back to the foreground: Browse can stay open
 * past midnight, and its day groups and "Yesterday" labels follow the calendar.
 */
@Composable
fun rememberToday(): LocalDate {
    var today by remember { mutableStateOf(LocalDate.now()) }
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { today = LocalDate.now() }
    }
    return today
}

/**
 * Opens a document in the viewer. Media (images + videos) size the dive transform to their aspect: the
 * morph box is the content rect the poster grows into. Other file types morph a full-screen stand-in
 * instead (see DocumentPage).
 */
@Composable
fun rememberOpenDocument(onDocumentClick: (documentId: String, aspect: Float?) -> Unit): (DocumentDto) -> Unit {
    val latest by rememberUpdatedState(onDocumentClick)
    return remember {
        { document ->
            val isMedia = isImageDocument(document) || isVideoDocument(document)
            latest(document.id, if (isMedia) document.mediaAspectOrNull() else null)
        }
    }
}

/** A screen of documents, as far as touching one of them is concerned. */
interface DocumentListHandler {
    val favourites: FavouriteController

    fun enterSelection(id: String)

    fun toggleSelect(id: String)

    /** Hand the order of the list [opened] sits in to the viewer. */
    fun prepareSequence(opened: DocumentDto)

    fun prefetch(document: DocumentDto)
}

/** Tap opens (or, once something is selected, selects); long press starts or extends a selection. */
internal fun documentRowActions(
    handler: DocumentListHandler,
    selectedIds: Set<String>,
    starredIds: Set<String>,
    openDocument: (DocumentDto) -> Unit,
    onGroupClick: (RecentRow.Group) -> Unit = {},
    onGroupLongClick: (RecentRow.Group) -> Unit = {},
): RowActions {
    val selecting = selectedIds.isNotEmpty()
    return RowActions(
        selected = { it.id in selectedIds },
        onClick = { doc ->
            if (selecting) {
                handler.toggleSelect(doc.id)
            } else {
                // Publish the shown list's order so the viewer swipes through it and nothing else.
                handler.prepareSequence(doc)
                handler.prefetch(doc)
                openDocument(doc)
            }
        },
        onLongClick = { doc -> if (selecting) handler.toggleSelect(doc.id) else handler.enterSelection(doc.id) },
        starred = { it.id in starredIds },
        onToggleStar = { handler.favourites.toggle(FavouriteKey(FavouriteType.DOCUMENT, it.id)) },
        onGroupClick = onGroupClick,
        onGroupLongClick = onGroupLongClick,
    )
}
