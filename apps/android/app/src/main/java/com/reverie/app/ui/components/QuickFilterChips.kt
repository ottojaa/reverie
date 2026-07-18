package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Screenshot
import androidx.compose.material.icons.outlined.Straighten
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.QuickFilter

/** Data-driven search shortcuts with live counts. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QuickFilterChips(
    filters: List<QuickFilter>,
    onSelect: (QuickFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        filters.forEach { filter ->
            AssistChip(
                onClick = { onSelect(filter) },
                label = { Text("${filter.label} · ${filter.count}") },
                leadingIcon = iconFor(filter.icon)?.let { icon ->
                    { Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp)) }
                },
            )
        }
    }
}

private fun iconFor(slug: String?): ImageVector? = when (slug) {
    "photo", "image" -> Icons.Outlined.Photo
    "screenshot" -> Icons.Outlined.Screenshot
    "document", "file-text" -> Icons.Outlined.Description
    "video" -> Icons.Outlined.Videocam
    "receipt" -> Icons.Outlined.Receipt
    "recent", "clock" -> Icons.Outlined.CalendarToday
    "size", "hard-drive" -> Icons.Outlined.Straighten
    "summary", "sparkles" -> Icons.Outlined.AutoAwesome
    else -> null
}
