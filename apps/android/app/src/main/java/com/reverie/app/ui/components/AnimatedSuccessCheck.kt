package com.reverie.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * A checkmark that draws itself on: the ring sweeps closed, then the tick strokes in. Mirrors the
 * web app's upload-success animation (AnimatedCheckCircle). Runs once when it enters composition.
 */
@Composable
fun AnimatedSuccessCheck(
    color: Color,
    modifier: Modifier = Modifier,
    diameter: Dp = 28.dp,
) {
    val alpha = remember { Animatable(0f) }
    val ring = remember { Animatable(0f) }
    val tick = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        launch { alpha.animateTo(1f, tween(200)) }
        launch { ring.animateTo(1f, tween(600, easing = EaseInOut)) }
        launch { tick.animateTo(1f, tween(800, delayMillis = 350, easing = CubicBezierEasing(0.33f, 1f, 0.53f, 1f))) }
    }

    Canvas(
        modifier = modifier
            .size(diameter)
            .graphicsLayer { this.alpha = alpha.value },
    ) {
        val strokePx = 2.dp.toPx()
        val stroke = Stroke(width = strokePx, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val inset = strokePx / 2f

        drawArc(
            color = color,
            startAngle = -90f,
            sweepAngle = 360f * ring.value,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = Size(size.width - strokePx, size.height - strokePx),
            style = stroke,
        )

        val tickPath = Path().apply {
            moveTo(size.width * 0.28f, size.height * 0.52f)
            lineTo(size.width * 0.44f, size.height * 0.68f)
            lineTo(size.width * 0.72f, size.height * 0.36f)
        }
        val measure = PathMeasure().apply { setPath(tickPath, forceClosed = false) }
        val drawn = Path()
        measure.getSegment(0f, measure.length * tick.value, drawn, startWithMoveTo = true)
        drawPath(drawn, color = color, style = stroke)
    }
}
