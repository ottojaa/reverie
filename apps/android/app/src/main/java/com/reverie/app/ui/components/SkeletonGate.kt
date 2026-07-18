package com.reverie.app.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.MaterialTheme
import kotlinx.coroutines.delay

/**
 * Whether a loading skeleton should be shown. Mirrors the web's rule of only revealing a
 * skeleton once loading exceeds [delayMs] (~200ms), so fast responses never flash one.
 */
@Composable
fun rememberSkeletonVisible(isLoading: Boolean, delayMs: Long = 200): Boolean {
    var elapsed by remember { mutableStateOf(false) }
    LaunchedEffect(isLoading) {
        elapsed = false
        if (isLoading) {
            delay(delayMs)
            elapsed = true
        }
    }
    return isLoading && elapsed
}

/** An animated left-to-right shimmer gradient for skeleton placeholders. */
@Composable
fun shimmerBrush(): Brush {
    val base = MaterialTheme.colorScheme.surfaceContainerHighest
    val highlight = MaterialTheme.colorScheme.surfaceContainerHigh
    val colors = listOf(base, highlight, base)

    val transition = rememberInfiniteTransition(label = "shimmer")
    val translate by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1000f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200),
            repeatMode = RepeatMode.Restart,
        ),
        label = "shimmer-translate",
    )

    return Brush.linearGradient(
        colors = colors,
        start = Offset(translate - 500f, 0f),
        end = Offset(translate, 0f),
    )
}

/** A flat placeholder colour for skeletons that don't need animation. */
@Composable
fun skeletonColor(): Color = MaterialTheme.colorScheme.surfaceContainerHighest
