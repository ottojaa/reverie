package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * Horizontally-scrolling filter pills: Type, Date and More, each opening a sheet. [leading] comes before
 * them. [moreValues] are the chosen values More is labelled with; it can also be selected without any.
 */
@Composable
fun FilterPillBar(
    typeValues: List<String>,
    dateActive: Boolean,
    moreValues: List<String>,
    isMoreActive: Boolean,
    hasAnyActive: Boolean,
    onOpenType: () -> Unit,
    onOpenDate: () -> Unit,
    onOpenMore: () -> Unit,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) {
    LazyRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        if (leading != null) item(key = "leading") { leading() }
        item(key = "type") {
            DimensionPill(label = pillLabel("Type", typeValues), selected = typeValues.isNotEmpty(), onClick = onOpenType)
        }
        item(key = "date") {
            DimensionPill(label = "Date", selected = dateActive, leadingIcon = Icons.Outlined.CalendarToday, onClick = onOpenDate)
        }
        item(key = "more") {
            DimensionPill(
                label = pillLabel("More", moreValues),
                selected = isMoreActive,
                leadingIcon = Icons.Outlined.Tune,
                onClick = onOpenMore,
            )
        }
        if (hasAnyActive) {
            item(key = "clear") { TextButton(onClick = onClearAll) { Text("Clear all") } }
        }
    }
}

@Composable
private fun DimensionPill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    leadingIcon: ImageVector? = null,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        shape = CircleShape,
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
