package com.reverie.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import androidx.compose.ui.util.lerp
import com.reverie.app.ui.theme.MEDIUM_CORNER

/**
 * A gallery tile. While [selected] its [picture] springs slightly smaller with rounded corners, revealing a
 * frame, as a check pops into the top corner. [overlay] is drawn over the tile and keeps its size.
 */
@Composable
internal fun SelectableTile(
    selected: Boolean,
    modifier: Modifier = Modifier,
    overlay: @Composable BoxScope.() -> Unit = {},
    picture: @Composable BoxScope.() -> Unit,
) {
    // One progress drives the scale and the corners, so selecting and unselecting animate alike.
    val progress by animateFloatAsState(
        targetValue = if (selected) 1f else 0f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMediumLow),
        label = "selection",
    )
    val scale = lerp(1f, 0.86f, progress)
    // Clamp for the corner: the bouncy spring undershoots below 0 on deselect, and a negative
    // corner radius crashes the shape. Scale can keep the (always-positive) overshoot.
    val corner = lerp(0.dp, MEDIUM_CORNER, progress.coerceIn(0f, 1f))

    // The frame is muted, and fully covered while the tile is not selected.
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant)) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                }
                .clip(MaterialTheme.shapes.medium.copy(CornerSize(corner))),
            content = picture,
        )
        AnimatedVisibility(
            visible = selected,
            enter = scaleIn(spring(stiffness = Spring.StiffnessMediumLow)) + fadeIn(),
            exit = scaleOut() + fadeOut(),
            modifier = Modifier.align(Alignment.TopStart).padding(6.dp),
        ) {
            SelectedCheck()
        }
        overlay()
    }
}

@Composable
internal fun SelectedCheck(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(24.dp)
            .background(MaterialTheme.colorScheme.primary, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.Check,
            contentDescription = "Selected",
            tint = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.size(15.dp),
        )
    }
}

/** A row's picture, [size] across, whose place a check takes while the row is selected. */
@Composable
internal fun SelectablePicture(selected: Boolean, size: Dp, picture: @Composable () -> Unit) {
    if (!selected) return picture()
    Box(Modifier.size(size), contentAlignment = Alignment.Center) { SelectedCheck(Modifier.size(36.dp)) }
}

/** The tint behind a selected row. */
@Composable
internal fun Modifier.selectedBackground(isSelected: Boolean): Modifier =
    background(if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
