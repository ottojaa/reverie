package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.settings.FolderViewMode
import com.reverie.app.ui.components.ChoiceChip

/** The folder page's kind filter; nothing when there is only one kind to show. Scrolls when it doesn't fit. */
@Composable
fun FolderChipRow(chips: List<FolderChip>, selected: DocumentKind?, onSelect: (DocumentKind?) -> Unit) {
    if (chips.isEmpty()) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = 14.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        chips.forEach { chip ->
            ChoiceChip(
                label = chip.kind?.let(::kindTitle) ?: "All",
                count = chip.count,
                isSelected = chip.kind == selected,
                onClick = { onSelect(chip.kind) },
            )
        }
    }
}

/** The top bar's cards/list switch. Its icon is the view a tap changes to. */
@Composable
fun ViewSwitch(mode: FolderViewMode, onChange: (FolderViewMode) -> Unit) {
    val other = if (mode == FolderViewMode.GRID) FolderViewMode.LIST else FolderViewMode.GRID
    IconButton(onClick = { onChange(other) }) {
        if (other == FolderViewMode.LIST) {
            Icon(Icons.AutoMirrored.Outlined.FormatListBulleted, contentDescription = "Show as list")
        } else {
            Icon(Icons.Outlined.GridView, contentDescription = "Show as cards")
        }
    }
}
