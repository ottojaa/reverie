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

/** What the title block says: the folder, "My Files" or a kind, and the line under it. */
data class BrowseTitle(
    val text: String,
    val subtitle: String,
    /** A folder's Browse has the "Open in Canvas" menu. */
    val isFolder: Boolean,
)

/**
 * The part of Browse that slides away on scroll: back arrow (inside a folder or a kind screen), title,
 * subtitle and the processing pill. It paints its own opaque background because the list scrolls underneath it.
 */
@Composable
fun BrowseHeader(
    title: BrowseTitle,
    processingCount: Int,
    onProcessingClick: () -> Unit,
    onCanvas: () -> Unit,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .padding(bottom = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(start = if (onBack != null) 4.dp else 20.dp, top = 8.dp, end = 8.dp)) {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = title.text,
                    fontSize = 32.sp,
                    lineHeight = 40.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = title.subtitle,
                    fontSize = 15.sp,
                    lineHeight = 22.sp,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            ProcessingStatusBadge(count = processingCount, onClick = onProcessingClick)
            if (title.isFolder) FolderMenu(onCanvas)
        }
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
