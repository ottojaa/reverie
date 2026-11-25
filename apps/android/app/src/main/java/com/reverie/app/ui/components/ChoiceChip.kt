package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The app's pill chip. With [isSelected] set it is one of a set of choices (put the row in a
 * `selectableGroup`); with it null it is a plain action, or a muted label when there is no [onClick].
 */
@Composable
fun ChoiceChip(
    label: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    isSelected: Boolean? = null,
    onClick: (() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    val isOn = isSelected == true
    val content = when {
        isOn -> colors.onPrimaryContainer
        isSelected == false || onClick == null -> colors.onSurfaceVariant
        else -> colors.onSurface
    }
    val tap = when {
        onClick == null -> Modifier
        isSelected == null -> Modifier.clickable(onClick = onClick)
        else -> Modifier.selectable(selected = isSelected, role = Role.Tab, onClick = onClick)
    }
    Row(
        modifier
            .heightIn(min = 36.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (isOn) colors.primaryContainer else colors.surfaceContainer)
            .then(tap)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (isOn) FontWeight.Medium else FontWeight.Normal,
            color = content,
            maxLines = 1,
        )
        if (count != null) {
            Text(
                count.toString(),
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 12.sp, fontFeatureSettings = "tnum"),
                color = if (isOn) content else colors.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}
