package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.components.ProcessingStatusBadge

/** Height of a floating chip. */
val CHIP_HEIGHT = 30.dp

/** The gap between the status bar and the chips, and between the chips and what lies below them. */
val CHIP_GAP = 8.dp

private val FADE_HEIGHT = 64.dp
private const val FADE_PEAK = 0.5f
private const val CHIP_SURFACE_ALPHA = 0.78f

/**
 * What stays on screen once the header has slid away: a light fade behind the status bar, the month or
 * day of the list's top edge in a rounded chip at the left, and the Processing pill as a matching chip
 * at the right. No solid band. [visibility] is read at draw time (0 = header fully shown, 1 = fully
 * hidden), so scrolling doesn't recompose it. The Library passes no [heading]: it shows only the pill.
 */
@Composable
fun ScrollChips(
    heading: FeedItem.Header?,
    processingCount: Int,
    onProcessingClick: () -> Unit,
    visibility: () -> Float,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxWidth().graphicsLayer { alpha = visibility() }) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(FADE_HEIGHT)
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = FADE_PEAK), Color.Transparent))),
        )
        val title = heading?.title
        if (!title.isNullOrEmpty()) DateChip(title)
        // The header's own pill sits at the same spot while the header is showing: only act on this one once it has taken over.
        if (processingCount > 0) {
            Chip(Modifier.align(Alignment.TopEnd).padding(end = 12.dp)) {
                ProcessingStatusBadge(count = processingCount, onClick = { if (visibility() > 0.5f) onProcessingClick() })
            }
        }
    }
}

@Composable
private fun BoxScope.DateChip(title: String) {
    Chip(Modifier.align(Alignment.TopStart).padding(start = 12.dp)) {
        Text(
            text = title,
            fontSize = 14.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
    }
}

/** A 30dp pill on a 78% surface with a soft shadow, below the status bar. */
@Composable
private fun Chip(modifier: Modifier, content: @Composable () -> Unit) {
    Box(
        modifier = modifier
            .statusBarsPadding()
            .padding(top = CHIP_GAP)
            .height(CHIP_HEIGHT)
            .shadow(6.dp, CircleShape, clip = false)
            .background(MaterialTheme.colorScheme.surface.copy(alpha = CHIP_SURFACE_ALPHA), CircleShape),
        contentAlignment = Alignment.Center,
    ) { content() }
}
