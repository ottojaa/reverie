package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.reverie.app.util.formatBytes

/** "Collections", how much there is, the filter and new-collection actions, and the two chips. */
@Composable
fun CollectionsHeader(state: CollectionsUiState, actions: CollectionsActions, modifier: Modifier = Modifier) {
    var showFilter by rememberSaveable { mutableStateOf(false) }
    val filterOpen = showFilter || state.filter.isNotEmpty()

    Column(modifier) {
        Row(Modifier.padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text("Collections", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    headerSummary(state.collectionCount, state.folderCount),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            IconButton(onClick = { showFilter = !showFilter }) {
                Icon(Icons.Outlined.Search, contentDescription = "Filter collections")
            }
            IconButton(onClick = actions.onNewCollection) {
                Icon(Icons.Outlined.Add, contentDescription = "New collection", tint = MaterialTheme.colorScheme.primary)
            }
        }
        if (filterOpen) FilterField(state.filter, actions.onFilterChange)
        Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("All documents", onClick = actions.onOpenAllDocuments)
            if (state.storageQuota > 0) {
                Chip("${formatBytes(state.storageUsed)} of ${formatBytes(state.storageQuota)}", muted = true)
            }
        }
    }
}

internal fun headerSummary(collections: Int, folders: Int): String =
    "$collections ${if (collections == 1) "collection" else "collections"} · $folders ${if (folders == 1) "folder" else "folders"}"

@Composable
private fun Chip(text: String, muted: Boolean = false, onClick: (() -> Unit)? = null) {
    val shape = RoundedCornerShape(18.dp)
    Surface(
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = if (onClick == null) Modifier else Modifier.clickable(onClick = onClick),
    ) {
        Box(Modifier.height(36.dp).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
            Text(
                text,
                style = MaterialTheme.typography.bodyMedium,
                color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun FilterField(value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text("Filter collections") },
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                IconButton(onClick = { onValueChange("") }) {
                    Icon(Icons.Outlined.Close, contentDescription = "Clear filter")
                }
            }
        },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
    )
}
