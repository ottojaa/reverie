package com.reverie.app.ui.screens.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.components.FolderRow
import com.reverie.app.ui.components.ROOT_NAME
import com.reverie.app.ui.navigation.DiveSection
import com.reverie.app.ui.screens.browse.ChromeSlot
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.screens.browse.RecentEntry
import com.reverie.app.ui.screens.browse.RecentEntryView
import com.reverie.app.ui.screens.browse.RecentRow
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.manage.RowSelection
import java.time.LocalDate
import java.time.ZoneId

/** Names the "My files" file rows as a list of their own to the dive transition. */
internal const val UNFILED_SECTION = "unfiled"

/** The Library's ways out. */
class LibraryLinks(
    val onOpenFolder: (folderId: String) -> Unit,
    val onOpenList: (FeedSource) -> Unit,
    val onOpenMyFiles: () -> Unit,
    val onOpenFavourites: () -> Unit,
    /** Opens search over the whole library with [query] filled in. */
    val onSearch: (query: String) -> Unit,
    val onOpenTrash: () -> Unit,
)

/** What the Library shows beside its own contents. */
data class LibraryMarks(
    val folderCovers: Map<String, FolderCoverDto> = emptyMap(),
    val starredFolderIds: Set<String> = emptySet(),
    /** Null until the favourites have been read. */
    val favouriteCount: Int? = null,
    val backup: BackupStatus = BackupStatus.Unknown,
    /** The order the shortcut chips were last put in (see [orderedShortcuts]); empty until they have been. */
    val shortcutOrder: List<String> = emptyList(),
)

/** What touching the Library's documents and buttons does. */
class LibraryActions(
    val recent: RowActions,
    val unfiled: RowActions,
    val onLoadMore: () -> Unit,
    val onNewFolder: () -> Unit,
    val onFocusConsumed: () -> Unit,
    /** The folder rows' part in the Library's selection. */
    val folders: RowSelection = RowSelection(),
    /** The shortcut chips on show were moved into this order. */
    val onReorderShortcuts: (shown: List<String>) -> Unit = {},
)

/** The document the viewer was last on, in the section that opened it, until it has been brought into view. */
data class LibraryFocus(val recent: String? = null, val unfiled: String? = null)

/** The day the page is read on, for its "Yesterday" labels. */
data class LibraryDay(val today: LocalDate, val zone: ZoneId)

// Where Recently added sits in the page's list. Between it and the first file row of "My files" come that
// section's heading and its folder rows.
private const val RECENT_ITEM = 4
private const val UNFILED_ITEM_AFTER_FOLDERS = RECENT_ITEM + 2

/** The Library page: kinds, ready-made searches, what was added last, and the top of "My files". */
@Composable
fun LibraryBody(
    state: LibraryState,
    marks: LibraryMarks,
    links: LibraryLinks,
    actions: LibraryActions,
    day: LibraryDay,
    slot: ChromeSlot,
    focus: LibraryFocus = LibraryFocus(),
    listState: LazyListState = rememberLazyListState(),
) {
    val recentRowState = rememberLazyListState()
    val shortcuts = libraryShortcuts(state.smartViews, marks, links)
    var isReordering by rememberSaveable { mutableStateOf(false) }
    ReturnScroll(state, focus, listState, recentRowState, actions.onFocusConsumed)
    LazyColumn(state = listState, contentPadding = slot.contentPadding, modifier = slot.modifier.fillMaxSize()) {
        // Every item up to Recently added is always there, if empty, so the places below it stay put.
        item(key = "backup") { BackupLine(marks.backup, state.total) }
        item(key = "kinds") {
            LibraryBento(state.summary, state.covers, onOpen = { links.onOpenList(FeedSource.of(it)) })
        }
        item(key = "chips") { LibraryChips(shortcuts, onReorder = { isReordering = true }) }
        item(key = "recent-heading") {
            if (state.recent.documents.documents.isEmpty()) return@item
            SectionHeading("Recently added", "See all") { links.onOpenList(FeedSource.RECENT) }
        }
        item(key = "recent") {
            if (state.hasNoDocuments) return@item NothingUploaded(slot.onUpload)
            RecentlyAdded(state.recent, actions.recent, day, recentRowState, actions.onLoadMore)
        }
        item(key = "my-files-heading") { SectionHeading(ROOT_NAME, "New folder", actions.onNewFolder) }
        folderRows(state, marks, links, actions)
        fileRows(state, actions.unfiled, day)
        seeAllMyFiles(state, links.onOpenMyFiles)
    }
    if (isReordering) {
        ReorderShortcutsSheet(shortcuts, actions.onReorderShortcuts, onDismiss = { isReordering = false })
    }
}

private fun LazyListScope.folderRows(
    state: LibraryState,
    marks: LibraryMarks,
    links: LibraryLinks,
    actions: LibraryActions,
) {
    items(state.folders, key = { "folder:" + it.id }) { folder ->
        FolderRow(
            folder = folder,
            cover = marks.folderCovers[folder.id],
            meta = folderMeta(folder),
            onClick = { actions.folders.tap(folder.id) { links.onOpenFolder(folder.id) } },
            onLongClick = { actions.folders.toggle(folder.id) },
            selected = folder.id in actions.folders,
            starred = folder.id in marks.starredFolderIds,
        )
    }
}

/** The first of the files that are directly in "My files". */
private fun LazyListScope.fileRows(state: LibraryState, actions: RowActions, day: LibraryDay) {
    items(state.unfiledRows, key = { "unfiled:" + it.id }) { document ->
        DiveSection(UNFILED_SECTION) {
            RecentEntryView(RecentEntry.Row(RecentRow.Single(document)), actions, day.today, day.zone)
        }
    }
}

/** The way to the whole of "My files", saying how much is directly in it; nothing while it holds nothing. */
private fun LazyListScope.seeAllMyFiles(state: LibraryState, onOpen: () -> Unit) {
    // The server's total of files, or what is cached when it has not answered.
    val count = state.folders.size + maxOf(state.unfiled.total, state.unfiled.documents.size)
    if (count == 0) return
    item(key = "my-files-all") {
        Button(
            onClick = onOpen,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainer,
                contentColor = MaterialTheme.colorScheme.primary,
            ),
            modifier = Modifier.fillMaxWidth().padding(start = 20.dp, top = 6.dp, end = 20.dp).heightIn(min = 48.dp),
        ) {
            Text("See all $count in $ROOT_NAME")
        }
    }
}

/** Brings the document the viewer was closed on into view, if it is not there already. */
@Composable
private fun ReturnScroll(
    state: LibraryState,
    focus: LibraryFocus,
    listState: LazyListState,
    recentRowState: LazyListState,
    onFocusConsumed: () -> Unit,
) {
    LaunchedEffect(focus.recent, state.recent.documents) {
        val id = focus.recent ?: return@LaunchedEffect
        val position = state.recent.documents.documents.indexOfFirst { it.id == id }
        // A document whose page has not loaded yet keeps the signal until it has.
        if (position < 0) return@LaunchedEffect
        listState.showItem(RECENT_ITEM)
        recentRowState.showItem(position)
        onFocusConsumed()
    }
    LaunchedEffect(focus.unfiled, state.unfiledRows) {
        val id = focus.unfiled ?: return@LaunchedEffect
        val rows = state.unfiledRows
        if (rows.isEmpty()) return@LaunchedEffect
        val position = rows.indexOfFirst { it.id == id }
        // The viewer can have swiped past the rows shown here; there is then nothing to scroll to.
        if (position >= 0) listState.showItem(UNFILED_ITEM_AFTER_FOLDERS + state.folders.size + position)
        onFocusConsumed()
    }
}

private suspend fun LazyListState.showItem(index: Int) {
    if (layoutInfo.visibleItemsInfo.none { it.index == index }) scrollToItem(index)
}

@Composable
private fun SectionHeading(title: String, action: String?, onAction: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, top = 20.dp, end = 8.dp).heightIn(min = 44.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            fontSize = 17.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
private fun NothingUploaded(onUpload: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Nothing uploaded yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onUpload) { Text("Upload") }
    }
}
