package com.reverie.app.ui.screens.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.domain.search.FilterKey

private data class SizePreset(val label: String, val value: String?)

private val SIZE_PRESETS = listOf(
    SizePreset("Any", null),
    SizePreset("Under 1 MB", "<1MB"),
    SizePreset("Over 10 MB", ">10MB"),
    SizePreset("Over 100 MB", ">100MB"),
)

/** The filters without a pill of their own: category and tags, which open their lists, then text and size. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreFiltersSheet(
    state: SearchUiState,
    hasTextMode: HasTextMode,
    onOpenFacet: (FilterKey) -> Unit,
    onRemoveFolder: () -> Unit,
    onSetHasText: (HasTextMode) -> Unit,
    onSetSize: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("More filters", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp))
            Column {
                FacetRow("Category", state.activeValues(FilterKey.CATEGORY)) { onOpenFacet(FilterKey.CATEGORY) }
                FacetRow("Tags", state.activeValues(FilterKey.TAG)) { onOpenFacet(FilterKey.TAG) }
                state.activeValues(FilterKey.FOLDER).takeIf { it.isNotEmpty() }?.let { FolderRow(it, onRemoveFolder) }
            }
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                TextFilter(hasTextMode, onSetHasText)
                SizeFilter(state.activeValues(FilterKey.SIZE).firstOrNull(), onSetSize)
            }
        }
    }
}

@Composable
private fun FacetRow(label: String, chosen: List<String>, onOpen: () -> Unit) {
    val summary = chosen.joinToString { value -> value.replaceFirstChar { it.uppercase() } }.ifEmpty { "Any" }
    ListItem(
        headlineContent = { Text(label) },
        supportingContent = { Text(summary, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(onClick = onOpen).padding(horizontal = 4.dp),
    )
}

@Composable
private fun FolderRow(chosen: List<String>, onRemove: () -> Unit) {
    ListItem(
        headlineContent = { Text("Folder") },
        supportingContent = { Text(chosen.joinToString(), maxLines = 2, overflow = TextOverflow.Ellipsis) },
        trailingContent = {
            IconButton(onClick = onRemove) { Icon(Icons.Outlined.Clear, contentDescription = "Remove the folder filter") }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.padding(horizontal = 4.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TextFilter(mode: HasTextMode, onSet: (HasTextMode) -> Unit) {
    Text("Text", style = MaterialTheme.typography.titleSmall)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        val options = listOf(HasTextMode.ANY to "Any", HasTextMode.HAS to "Has text", HasTextMode.NONE to "No text")
        options.forEachIndexed { index, (option, label) ->
            SegmentedButton(
                selected = mode == option,
                onClick = { onSet(option) },
                shape = SegmentedButtonDefaults.itemShape(index, options.size),
            ) { Text(label) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SizeFilter(value: String?, onSet: (String?) -> Unit) {
    Text("Size", style = MaterialTheme.typography.titleSmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SIZE_PRESETS.forEach { preset ->
            FilterChip(selected = value == preset.value, shape = CircleShape, onClick = { onSet(preset.value) }, label = { Text(preset.label) })
        }
    }
}
