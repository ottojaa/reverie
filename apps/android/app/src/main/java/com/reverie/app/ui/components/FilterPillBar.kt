package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.domain.search.FilterKey

data class FilterDimension(val label: String, val key: FilterKey)

val PRIMARY_DIMENSIONS = listOf(
    FilterDimension("Type", FilterKey.TYPE),
    FilterDimension("Category", FilterKey.CATEGORY),
    FilterDimension("Folder", FilterKey.FOLDER),
    FilterDimension("Tags", FilterKey.TAG),
)

/** Horizontally-scrolling filter pills; each opens a facet/date/more sheet. */
@Composable
fun FilterPillBar(
    activeValues: (FilterKey) -> List<String>,
    dateActive: Boolean,
    hasAnyActive: Boolean,
    onOpenDimension: (FilterKey) -> Unit,
    onOpenDate: () -> Unit,
    onOpenMore: () -> Unit,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
    ) {
        items(PRIMARY_DIMENSIONS, key = { it.label }) { dim ->
            val active = activeValues(dim.key)
            DimensionPill(
                label = pillLabel(dim.label, active),
                selected = active.isNotEmpty(),
                onClick = { onOpenDimension(dim.key) },
            )
        }
        item {
            DimensionPill(
                label = "Date",
                selected = dateActive,
                leadingIcon = Icons.Outlined.CalendarToday,
                onClick = onOpenDate,
            )
        }
        item {
            DimensionPill(
                label = "More",
                selected = false,
                leadingIcon = Icons.Outlined.Tune,
                onClick = onOpenMore,
            )
        }
        if (hasAnyActive) {
            item { TextButton(onClick = onClearAll) { Text("Clear all") } }
        }
    }
}

@Composable
private fun DimensionPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    leadingIcon: androidx.compose.ui.graphics.vector.ImageVector? = null,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        leadingIcon = leadingIcon?.let { { Icon(it, contentDescription = null, modifier = Modifier.size(18.dp)) } },
        trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null, modifier = Modifier.size(18.dp)) },
    )
}

private fun pillLabel(base: String, active: List<String>): String = when {
    active.isEmpty() -> base
    active.size == 1 -> "$base: ${active.first().replaceFirstChar { it.uppercase() }}"
    else -> "$base: ${active.first().replaceFirstChar { it.uppercase() }} +${active.size - 1}"
}
