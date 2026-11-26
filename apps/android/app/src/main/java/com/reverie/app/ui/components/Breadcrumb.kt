package com.reverie.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FolderWithChildren

/**
 * "My files › Travel › Portugal": [path] runs from the top level down. Every step opens that folder (null:
 * the root), except the folder being shown, which is the last step unless [endsAtCurrent] is off.
 * A long path scrolls to its end.
 */
@Composable
fun Breadcrumb(
    path: List<FolderWithChildren>,
    onOpen: (folderId: String?) -> Unit,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    endsAtCurrent: Boolean = true,
) {
    val scroll = rememberScrollState()
    LaunchedEffect(path.lastOrNull()?.id, scroll.maxValue) { scroll.scrollTo(scroll.maxValue) }

    Row(
        modifier = modifier.fillMaxWidth().horizontalScroll(scroll),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Crumb(ROOT_NAME, style, isCurrent = endsAtCurrent && path.isEmpty(), isRoot = true) { onOpen(null) }
        path.forEachIndexed { index, folder ->
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline,
                modifier = Modifier.size(16.dp),
            )
            val isCurrent = endsAtCurrent && index == path.lastIndex
            Crumb(folder.name, style, isCurrent, isRoot = false) { onOpen(folder.id) }
        }
    }
}

@Composable
private fun Crumb(name: String, style: TextStyle, isCurrent: Boolean, isRoot: Boolean, onClick: () -> Unit) {
    val color = if (isCurrent) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .clickable(enabled = !isCurrent, onClick = onClick)
            .heightIn(min = 36.dp)
            .padding(horizontal = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (isRoot) Icon(LibraryIcon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
        Text(name, style = style, color = color, fontWeight = FontWeight.SemiBold.takeIf { isCurrent }, maxLines = 1)
    }
}
