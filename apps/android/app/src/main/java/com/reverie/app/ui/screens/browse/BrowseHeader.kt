package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.components.ProcessingStatusBadge

/** What the title block says: the folder (or "My Files"), the open tab's total, and whether it can go back. */
data class BrowseTitle(
    val text: String,
    val subtitle: String,
    val isFolder: Boolean,
)

/**
 * The part of Browse that slides away on scroll: title, the tab's total, the processing pill and the
 * tab bar. It paints its own opaque background because the list scrolls underneath it.
 */
@Composable
fun BrowseHeader(
    title: BrowseTitle,
    tab: BrowseTab,
    processingCount: Int,
    onSelectTab: (BrowseTab) -> Unit,
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
            .padding(bottom = 4.dp),
    ) {
        Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(start = if (onBack != null && title.isFolder) 4.dp else 20.dp, top = 8.dp, end = 8.dp)) {
            if (title.isFolder && onBack != null) {
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
        BrowseTabBar(
            selected = tab,
            onSelect = onSelectTab,
            modifier = Modifier.padding(start = 16.dp, top = 14.dp, end = 16.dp),
        )
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

/**
 * The slim strip left behind when the header has slid away: the month (Photos, Videos) or day (All,
 * Files) at the top of the list, and the processing pill. It fades in as the header leaves.
 * [visibility] is read at draw time (0 = header fully shown, 1 = fully hidden), so scrolling
 * doesn't recompose it.
 */
@Composable
fun PinnedBand(
    heading: FeedItem.Header?,
    processingCount: Int,
    onProcessingClick: () -> Unit,
    visibility: () -> Float,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .graphicsLayer { alpha = visibility() }
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.9f))
            .statusBarsPadding()
            .height(BAND_HEIGHT)
            .padding(start = 20.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = heading?.title.orEmpty(),
            fontSize = 17.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = heading?.trailing.orEmpty(),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        // The header's own pill sits at the same spot while the header is showing: only act on this one once it has taken over.
        ProcessingStatusBadge(count = processingCount, onClick = { if (visibility() > 0.5f) onProcessingClick() })
    }
}

/** Height of the pinned band below the status bar. */
val BAND_HEIGHT = 40.dp
