package com.reverie.app.ui.screens.upload

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.components.SectionIcon
import com.reverie.app.ui.screens.collections.CreateEditFolderSheet
import com.reverie.app.ui.screens.collections.FolderFormData

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderPickerSheet(
    sections: List<FolderPickerSection>,
    loading: Boolean,
    onSelect: (FolderOption) -> Unit,
    onCreateFolder: (parentId: String?, form: FolderFormData) -> Unit,
    onCreateCollection: (FolderFormData) -> Unit,
    onDismiss: () -> Unit,
    selectedId: String? = null,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by remember { mutableStateOf("") }
    var collapsed by remember { mutableStateOf(emptySet<String>()) }
    var createInSection by remember { mutableStateOf<FolderPickerSection?>(null) }
    var createCollectionOpen by remember { mutableStateOf(false) }
    val visible = remember(sections, query) { filterSections(sections, query) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                // Lift the sheet above the keyboard when the search field is focused. No outer
                // verticalScroll here — the folder list is a LazyColumn (own scroll).
                .imePadding()
                .padding(horizontal = 20.dp)
                .padding(bottom = 16.dp),
        ) {
            Text("Choose a folder", style = MaterialTheme.typography.titleMedium)
            // Search only helps once there's something to search; hide it while loading/empty.
            if (sections.isNotEmpty()) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search folders") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                )
            }
            when {
                loading && sections.isEmpty() ->
                    Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                    }
                sections.isEmpty() -> EmptyPickerState(onCreateCollection = { createCollectionOpen = true })
                visible.isEmpty() -> Text(
                    "No folders match your search.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 12.dp),
                )
            }
            LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
                visible.forEach { section ->
                    val expanded = query.isNotBlank() || section.id !in collapsed
                    item(key = "header-${section.id}") {
                        SectionHeaderRow(
                            section = section,
                            expanded = expanded,
                            onToggle = { collapsed = collapsed.toggle(section.id) },
                            onNewFolder = { createInSection = section },
                        )
                    }
                    if (expanded) {
                        items(section.folders, key = { "folder-${it.id}" }) { folder ->
                            FolderRow(
                                folder = folder,
                                selected = folder.id == selectedId,
                                onClick = { onSelect(folder) },
                            )
                        }
                    }
                }
            }
        }
    }

    createInSection?.let { section ->
        CreateEditFolderSheet(
            title = "New folder in ${section.name}",
            initial = null,
            onSubmit = { form ->
                onCreateFolder(section.collectionId, form)
                createInSection = null
            },
            onDismiss = { createInSection = null },
        )
    }

    if (createCollectionOpen) {
        CreateEditFolderSheet(
            title = "New collection",
            initial = null,
            // Stay in the picker after creating — the new (empty) collection appears with its own
            // "+" so the user can add the folder they'll actually upload into.
            onSubmit = { form -> onCreateCollection(form); createCollectionOpen = false },
            onDismiss = { createCollectionOpen = false },
        )
    }
}

@Composable
private fun EmptyPickerState(onCreateCollection: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("No collections yet", style = MaterialTheme.typography.titleSmall)
        Text(
            "Create a collection, then add a folder to upload into.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Button(onClick = onCreateCollection) {
            Icon(Icons.Outlined.CreateNewFolder, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("New collection", modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
private fun SectionHeaderRow(
    section: FolderPickerSection,
    expanded: Boolean,
    onToggle: () -> Unit,
    onNewFolder: () -> Unit,
) {
    val rotation by animateFloatAsState(if (expanded) 90f else 0f, label = "chevron")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.rotate(rotation),
        )
        SectionIcon(emoji = section.emoji, size = 20.dp, modifier = Modifier.padding(start = 4.dp))
        Text(
            section.name,
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(start = 12.dp).weight(1f),
        )
        IconButton(onClick = onNewFolder) {
            Icon(Icons.Outlined.CreateNewFolder, contentDescription = "New folder in ${section.name}")
        }
    }
}

@Composable
private fun FolderRow(folder: FolderOption, selected: Boolean, onClick: () -> Unit) {
    val rowBackground = if (selected) {
        Modifier.background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(8.dp))
    } else {
        Modifier
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(rowBackground)
            .clickable(onClick = onClick)
            .padding(start = 32.dp, top = 10.dp, bottom = 10.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionIcon(emoji = folder.emoji, size = 20.dp)
        Text(
            folder.label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier
                .padding(start = 12.dp)
                .weight(1f),
        )
        if (selected) {
            Icon(
                Icons.Filled.Check,
                contentDescription = "Selected",
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

private fun Set<String>.toggle(id: String): Set<String> = if (id in this) this - id else this + id

private fun filterSections(sections: List<FolderPickerSection>, query: String): List<FolderPickerSection> {
    if (query.isBlank()) return sections

    return sections.mapNotNull { section ->
        if (section.name.contains(query, ignoreCase = true)) return@mapNotNull section
        val folders = section.folders.filter { it.label.contains(query, ignoreCase = true) }
        if (folders.isEmpty()) null else section.copy(folders = folders)
    }
}
