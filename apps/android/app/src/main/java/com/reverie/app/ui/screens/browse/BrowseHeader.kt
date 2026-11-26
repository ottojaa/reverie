package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.components.ProcessingStatusBadge

/** What the title block says, and the line under it (blank: none). */
data class BrowseTitle(val text: String, val subtitle: String)

/**
 * The part of Browse that slides away on scroll: back arrow (where there is somewhere to go back to), title,
 * subtitle and the processing pill. It paints its own opaque background because the list scrolls underneath it.
 *
 * @param title null for a bar of buttons only, where the screen's list carries its own title.
 * @param actions buttons of the screen's own, after the processing pill.
 */
@Composable
fun BrowseHeader(
    title: BrowseTitle?,
    processingCount: Int,
    onProcessingClick: () -> Unit,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .padding(start = if (onBack != null) 4.dp else 20.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
        }
        Column(Modifier.weight(1f)) {
            if (title != null) TitleBlock(title)
        }
        ProcessingStatusBadge(count = processingCount, onClick = onProcessingClick)
        actions()
    }
}

@Composable
private fun TitleBlock(title: BrowseTitle) {
    Text(
        text = title.text,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
    if (title.subtitle.isBlank()) return
    Text(
        text = title.subtitle,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
