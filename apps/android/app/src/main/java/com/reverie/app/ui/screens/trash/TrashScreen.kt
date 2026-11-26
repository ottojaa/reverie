package com.reverie.app.ui.screens.trash

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.domain.counted
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.components.SelectionAction
import com.reverie.app.ui.components.SelectionTopBar
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.browse.BrowseHeader
import com.reverie.app.ui.screens.browse.BrowseTitle
import com.reverie.app.ui.screens.browse.UnlockSheetHost
import com.reverie.app.ui.screens.favourites.ReverieSnackbarHost
import com.reverie.app.ui.screens.manage.RowSelection
import com.reverie.app.ui.screens.manage.SelectionOverlay
import java.time.Instant

private const val EMPTY_TRASH = "Trash is empty."

data class TrashActions(
    val onBack: () -> Unit,
    /** A tap on an item while nothing is selected. */
    val onOpen: (TrashItem) -> Unit,
    /** The pull gesture, and trying again after a failed read. */
    val onRefresh: () -> Unit,
    /** The items' part in the screen's selection. */
    val selection: RowSelection = RowSelection(),
)

/** Deleted files and folders, each of which can be restored or deleted for good. */
@Composable
fun TrashScreen(onBack: () -> Unit, viewModel: TrashViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val selectedIds by viewModel.selection.ids.collectAsStateWithLifecycle()
    val selected = remember(state, selectedIds) { state.listing?.toItems().orEmpty().filter { it.id in selectedIds } }
    val actions = TrashActions(
        onBack = onBack,
        onOpen = viewModel::open,
        onRefresh = viewModel::pullToRefresh,
        selection = RowSelection(selected.mapTo(mutableSetOf()) { it.id }, viewModel.selection::toggle),
    )

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.load() }
    LaunchedEffect(viewModel) { viewModel.notices.collect { snackbarHostState.showSnackbar(it) } }

    Box(Modifier.fillMaxSize()) {
        TrashContent(state, actions)
        TrashSelectionOverlay(selected, viewModel, Modifier.align(Alignment.TopCenter))
        ReverieSnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomBarInset()))
    }
    TrashDialogHost(viewModel)
    UnlockSheetHost(viewModel.unlocker)
}

@Composable
private fun TrashSelectionOverlay(selected: List<TrashItem>, viewModel: TrashViewModel, modifier: Modifier = Modifier) {
    // What the bar showed stays on it while it slides away.
    var shown by remember { mutableStateOf(selected) }
    if (selected.isNotEmpty()) shown = selected

    SelectionOverlay(selected.isNotEmpty(), viewModel.selection::clear, modifier) {
        TrashSelectionBar(
            count = shown.size,
            onClose = viewModel.selection::clear,
            onRestore = { viewModel.restore(selected) },
            onPurge = { viewModel.askToPurge(selected) },
        )
    }
}

/** The bar for the selected items, which can be restored or deleted for good. */
@Composable
fun TrashSelectionBar(count: Int, onClose: () -> Unit, onRestore: () -> Unit, onPurge: () -> Unit) {
    SelectionTopBar(count, onClose) {
        SelectionAction("Restore", Icons.Outlined.RestoreFromTrash, onRestore)
        SelectionAction("Delete forever", Icons.Outlined.DeleteForever, onPurge)
    }
}

@Composable
fun TrashContent(
    state: TrashUiState,
    actions: TrashActions,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
) {
    ReverieRefreshBox(isRefreshing = state.isPulling, onRefresh = actions.onRefresh, modifier = modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            val kept = state.listing?.let { "Kept for ${counted(it.retention_days, "day")}, then deleted for good" }
            BrowseHeader(
                title = BrowseTitle("Trash", kept.orEmpty()),
                processingCount = 0,
                onProcessingClick = {},
                onBack = actions.onBack,
            )
            // Messages are list items too, so that the screen can be pulled whatever it shows.
            LazyColumn(
                contentPadding = PaddingValues(bottom = bottomBarInset() + 16.dp),
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) {
                when {
                    state.error != null -> item { LoadError(state.error, actions.onRefresh) }
                    state.listing == null -> item { Loading() }
                    else -> trashRows(state.listing, now, actions)
                }
            }
        }
    }
}

private fun LazyListScope.trashRows(listing: TrashListDto, now: Instant, actions: TrashActions) {
    val rows = listing.toItems()
    if (rows.isEmpty()) item { Note(EMPTY_TRASH) }
    items(rows, key = { it.id }) { row ->
        TrashRow(
            item = row,
            now = now,
            onClick = { actions.selection.tap(row.id) { actions.onOpen(row) } },
            onLongClick = { actions.selection.toggle(row.id) },
            selected = row.id in actions.selection,
        )
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun LoadError(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Note(message)
        TextButton(onClick = onRetry) { Text("Try again") }
    }
}

@Composable
private fun Note(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
    )
}
