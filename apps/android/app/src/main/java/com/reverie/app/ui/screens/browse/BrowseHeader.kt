package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.components.ProcessingStatusBadge

/** What the title block says: the folder, "My Files" or a list, and the line under it (blank: none). */
data class BrowseTitle(
    val text: String,
    val subtitle: String,
    /** A folder page has the "Open in Canvas" menu. */
    val isFolder: Boolean,
    /** The smaller title block (28/14sp) of a folder page or a list; My Files keeps 32/15sp. */
    val compact: Boolean = false,
)

/**
 * The part of Browse that slides away on scroll: back arrow (where there is somewhere to go back to), title,
 * subtitle and the processing pill. It paints its own opaque background because the list scrolls underneath it.
 *
 * @param actions buttons of the screen's own, between the processing pill and the ⋮ menu.
 * @param below a row of the screen's own under the title block, sliding away with it.
 */
@Composable
fun BrowseHeader(
    title: BrowseTitle,
    processingCount: Int,
    onProcessingClick: () -> Unit,
    onCanvas: () -> Unit,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
    below: @Composable () -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .padding(bottom = 8.dp),
    ) {
        Row(verticalAlignment = if (title.compact) Alignment.CenterVertically else Alignment.Top, modifier = Modifier.padding(start = if (onBack != null) 4.dp else 20.dp, top = 8.dp, end = 8.dp)) {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = title.text,
                    fontSize = if (title.compact) 28.sp else 32.sp,
                    lineHeight = if (title.compact) 34.sp else 40.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (title.subtitle.isNotBlank()) {
                    Text(
                        text = title.subtitle,
                        fontSize = if (title.compact) 14.sp else 15.sp,
                        lineHeight = if (title.compact) 20.sp else 22.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            ProcessingStatusBadge(count = processingCount, onClick = onProcessingClick)
            actions()
            if (title.isFolder) FolderMenu(onCanvas)
        }
        below()
    }
}

@Composable
private fun FolderMenu(onCanvas: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    // The menu anchors to the Box around its button.
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("Open in Canvas") },
                leadingIcon = { Icon(Icons.Outlined.Dashboard, contentDescription = null) },
                onClick = { open = false; onCanvas() },
            )
        }
    }
}
