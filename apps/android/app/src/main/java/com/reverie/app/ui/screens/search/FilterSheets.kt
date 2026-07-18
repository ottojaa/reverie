package com.reverie.app.ui.screens.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FacetItem
import com.reverie.app.domain.search.FilterKey

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FacetListSheet(
    title: String,
    options: List<FacetItem>,
    activeValues: List<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            if (options.isEmpty()) {
                Text("No options available.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 16.dp))
            }
            LazyColumn(modifier = Modifier.heightIn(max = 400.dp)) {
                items(options, key = { it.name }) { item ->
                    val checked = item.selected == true || activeValues.any { it.equals(item.name, ignoreCase = true) }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onToggle(item.name) }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = checked, onCheckedChange = { onToggle(item.name) })
                        Text(item.name.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        Text("${item.count}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

private data class DatePreset(val label: String, val value: String?)

private val DATE_PRESETS = listOf(
    DatePreset("Any", null),
    DatePreset("Today", "today"),
    DatePreset("Yesterday", "yesterday"),
    DatePreset("Last week", "last-week"),
    DatePreset("Last month", "last-month"),
    DatePreset("Last year", "last-year"),
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DateFilterSheet(
    uploadedValue: String?,
    dateValue: String?,
    onSet: (FilterKey, String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var field by remember { mutableStateOf(FilterKey.UPLOADED) }
    val current = if (field == FilterKey.UPLOADED) uploadedValue else dateValue

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Date", style = MaterialTheme.typography.titleMedium)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(selected = field == FilterKey.UPLOADED, onClick = { field = FilterKey.UPLOADED }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Uploaded") }
                SegmentedButton(selected = field == FilterKey.DATE, onClick = { field = FilterKey.DATE }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Document date") }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DATE_PRESETS.forEach { preset ->
                    FilterChip(
                        selected = current == preset.value,
                        onClick = { onSet(field, preset.value) },
                        label = { Text(preset.label) },
                    )
                }
            }
        }
    }
}

private data class SizePreset(val label: String, val value: String?)

private val SIZE_PRESETS = listOf(
    SizePreset("Any", null),
    SizePreset("Under 1 MB", "<1MB"),
    SizePreset("Over 10 MB", ">10MB"),
    SizePreset("Over 100 MB", ">100MB"),
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MoreFiltersSheet(
    hasTextMode: HasTextMode,
    sizeValue: String?,
    onSetHasText: (HasTextMode) -> Unit,
    onSetSize: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("More filters", style = MaterialTheme.typography.titleMedium)

            Text("Text", style = MaterialTheme.typography.titleSmall)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                val options = listOf(HasTextMode.ANY to "Any", HasTextMode.HAS to "Has text", HasTextMode.NONE to "No text")
                options.forEachIndexed { index, (mode, label) ->
                    SegmentedButton(selected = hasTextMode == mode, onClick = { onSetHasText(mode) }, shape = SegmentedButtonDefaults.itemShape(index, options.size)) { Text(label) }
                }
            }

            Text("Size", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SIZE_PRESETS.forEach { preset ->
                    FilterChip(selected = sizeValue == preset.value, onClick = { onSetSize(preset.value) }, label = { Text(preset.label) })
                }
            }
        }
    }
}
