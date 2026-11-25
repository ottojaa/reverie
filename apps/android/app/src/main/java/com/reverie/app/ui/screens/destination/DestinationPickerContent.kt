package com.reverie.app.ui.screens.destination

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.components.Breadcrumb
import com.reverie.app.ui.components.FolderRow

/**
 * "Select destination": the folders one level at a time under a breadcrumb, and Cancel / Select for
 * the folder being looked at.
 */
@Composable
fun DestinationPickerContent(
    state: DestinationState,
    onOpen: (folderId: String?) -> Unit,
    onSearch: (query: String?) -> Unit,
    onNewFolder: () -> Unit,
    onCancel: () -> Unit,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        DestinationHeader(state, onOpen, onSearch, onNewFolder, onCancel)
        if (!state.isSearching) {
            Breadcrumb(state.path, onOpen, Modifier.padding(horizontal = 18.dp))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) { DestinationRows(state, onOpen) }
        state.error?.let { error ->
            Text(
                error,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }
        DestinationActions(state, onCancel, onSelect)
    }
}

@Composable
private fun DestinationRows(state: DestinationState, onOpen: (String) -> Unit) {
    if (state.isLoading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    if (state.rows.isEmpty()) {
        Text(
            if (state.isSearching) "No folders match “${state.query?.trim()}”." else "No folders here.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(32.dp),
        )
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(state.rows, key = { it.id }) { folder ->
            FolderRow(
                folder = folder,
                cover = state.covers[folder.id],
                meta = if (state.isSearching) state.locationOf(folder) else folderMeta(folder),
                onClick = { onOpen(folder.id) },
                coverSize = 44.dp,
            )
        }
    }
}

@Composable
private fun DestinationActions(state: DestinationState, onCancel: () -> Unit, onSelect: () -> Unit) {
    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceContainerHigh)
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp)) {
        if (!state.canSelect) {
            Text(
                "Open a folder to select it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onCancel, modifier = Modifier.height(48.dp)) { Text("Cancel") }
            Button(onClick = onSelect, enabled = state.canSelect, modifier = Modifier.weight(1f, fill = false).height(48.dp)) {
                Text("Select ${state.destination.name}", maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}
