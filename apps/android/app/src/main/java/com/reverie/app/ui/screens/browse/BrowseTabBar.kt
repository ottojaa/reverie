package com.reverie.app.ui.screens.browse

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Text-only pill switcher for the four Browse tabs: the open tab is a filled pill on a rounded track. */
@Composable
fun BrowseTabBar(
    selected: BrowseTab,
    onSelect: (BrowseTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(44.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(4.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        BrowseTab.entries.forEach { tab ->
            TabPill(tab = tab, isSelected = tab == selected, onSelect = onSelect, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun TabPill(
    tab: BrowseTab,
    isSelected: Boolean,
    onSelect: (BrowseTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val fill by animateColorAsState(if (isSelected) colors.primaryContainer else colors.surfaceContainer, label = "tab fill")
    val ink by animateColorAsState(if (isSelected) colors.onPrimaryContainer else colors.onSurfaceVariant, label = "tab ink")
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clip(CircleShape)
            .background(fill)
            .selectable(selected = isSelected, role = Role.Tab, onClick = { onSelect(tab) }),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = tab.label,
            color = ink,
            fontSize = 14.sp,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
            maxLines = 1,
        )
    }
}
