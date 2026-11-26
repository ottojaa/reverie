package com.reverie.app.ui.screens.browse

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.components.ProcessingStatusBadge

/** Height of a floating chip. */
val CHIP_HEIGHT = 32.dp

/** The gap between the status bar and the chips, and between the chips and what lies below them. */
val CHIP_GAP = 12.dp

private val FADE_HEIGHT = 64.dp
private const val FADE_PEAK = 0.5f
private const val CHIP_SURFACE_ALPHA = 0.82f
private const val CHIP_BORDER_ALPHA = 0.08f

/** Wide enough for most dates, so that the chip keeps its size as they change. */
private val DATE_CHIP_MIN_WIDTH = 104.dp
private const val ROLL_MILLIS = 180
private val ROLL_EASING = CubicBezierEasing(0.3f, 0.8f, 0.25f, 1f)

/**
 * The chips that float over a list: the date of what is at its top edge at the left, the Processing pill at the
 * right, and a light fade behind the status bar. No solid band. [visibility] is read at draw time (0 = header
 * fully shown, 1 = fully hidden), so scrolling doesn't recompose it; the fade and the pill appear with it, and so
 * does a date over a list of files, whose own headings name it until then. Over photos the date is the only one
 * there is, so it always shows, [dateBelow] pixels under the status bar to stay clear of the header.
 *
 * @param topDate null where there is no date to name: the Library shows only the pill.
 * @param dateBelow null while something else takes that spot; the date then appears with the pill.
 */
@Composable
fun ScrollChips(
    topDate: TopDate?,
    processingCount: Int,
    onProcessingClick: () -> Unit,
    visibility: () -> Float,
    modifier: Modifier = Modifier,
    dateBelow: (() -> Int)? = null,
) {
    val fadedIn = Modifier.graphicsLayer { alpha = visibility() }
    Box(modifier.fillMaxWidth()) {
        Box(
            fadedIn
                .fillMaxWidth()
                .height(FADE_HEIGHT)
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = FADE_PEAK), Color.Transparent))),
        )
        if (topDate != null) {
            val place = when {
                topDate.isOverPhotos && dateBelow != null -> Modifier.offset { IntOffset(0, dateBelow()) }
                else -> fadedIn
            }
            DateChip(topDate, Modifier.align(Alignment.TopStart).padding(start = 12.dp).then(place))
        }
        // The header's own pill sits at the same spot while the header is showing: only act on this one once it has taken over.
        if (processingCount > 0) {
            val backing = Modifier
                .shadow(6.dp, CircleShape, clip = false)
                .background(MaterialTheme.colorScheme.surface, CircleShape)
            Chip(Modifier.align(Alignment.TopEnd).padding(end = 12.dp).then(fadedIn), backing) {
                ProcessingStatusBadge(count = processingCount, onClick = { if (visibility() > 0.5f) onProcessingClick() })
            }
        }
    }
}

/** The date, rolling out for the next one as the list scrolls. With system animations off it just changes. */
@Composable
private fun DateChip(date: TopDate, modifier: Modifier) {
    val colors = MaterialTheme.colorScheme
    // Nearly opaque, so what scrolls under it barely shows through.
    val surface = Modifier
        .widthIn(min = DATE_CHIP_MIN_WIDTH)
        .clip(CircleShape)
        .background(colors.surface.copy(alpha = CHIP_SURFACE_ALPHA))
        .border(1.dp, colors.onSurface.copy(alpha = CHIP_BORDER_ALPHA), CircleShape)
    // The date starts at the same place whatever its length.
    Chip(modifier, surface, Alignment.CenterStart) {
        AnimatedContent(
            targetState = date,
            contentKey = { it.title },
            contentAlignment = Alignment.CenterStart,
            transitionSpec = { roll() },
            label = "date",
        ) { shown ->
            Box(Modifier.height(CHIP_HEIGHT).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                Text(
                    text = shown.title,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Scrolling down, the new date comes up from below and pushes the old one out; scrolling up, the other way. */
private fun AnimatedContentTransitionScope<TopDate>.roll(): ContentTransform {
    val from = if (targetState.position > initialState.position) 1 else -1
    val slide = tween<IntOffset>(ROLL_MILLIS, easing = ROLL_EASING)
    return (slideInVertically(slide) { from * it } togetherWith slideOutVertically(slide) { -from * it })
        .using(SizeTransform(clip = false) { _, _ -> tween<IntSize>(ROLL_MILLIS, easing = ROLL_EASING) })
}

/** A pill's place below the status bar; [surface] is what it is drawn on. */
@Composable
private fun Chip(
    modifier: Modifier,
    surface: Modifier,
    alignment: Alignment = Alignment.Center,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .statusBarsPadding()
            .padding(top = CHIP_GAP)
            .height(CHIP_HEIGHT)
            .then(surface),
        contentAlignment = alignment,
    ) { content() }
}
