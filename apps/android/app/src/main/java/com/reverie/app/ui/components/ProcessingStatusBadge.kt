package com.reverie.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.theme.ReverieTheme

/** A tonal chip showing how many documents are still processing (OCR/LLM/thumbnails). Hidden at 0. */
@Composable
fun ProcessingStatusBadge(
    count: Int,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(visible = count > 0, modifier = modifier) {
        val extended = ReverieTheme.extendedColors
        val transition = rememberInfiniteTransition(label = "processing")
        val angle by transition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(2000, easing = LinearEasing), RepeatMode.Restart),
            label = "spin",
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .background(extended.infoContainer, RoundedCornerShape(50))
                .padding(horizontal = 10.dp, vertical = 5.dp),
        ) {
            Icon(
                Icons.Outlined.AutoAwesome,
                contentDescription = null,
                tint = extended.onInfoContainer,
                modifier = Modifier
                    .size(14.dp)
                    .rotate(angle),
            )
            Text(
                text = " Processing $count",
                style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                color = extended.onInfoContainer,
            )
        }
    }
}
