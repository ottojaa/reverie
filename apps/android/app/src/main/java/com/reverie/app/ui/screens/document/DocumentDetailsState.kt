package com.reverie.app.ui.screens.document

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.navigation.MotionTuning

/** Fraction of the screen height the media occupies above the details drawer when it's open. */
const val DETAILS_HEADER_FRACTION = 0.4f

enum class DetailsValue { Closed, Open }

/**
 * Drives the swipe-up details interaction from a single [AnchoredDraggableState] with just two
 * detents: hidden and open. When open, the drawer is a full-height sheet whose top region is
 * transparent (revealing the media); scrolling its content up simply flows the info over the media
 * to use the whole screen — no third "expanded" anchor, so it scrolls freely instead of snapping.
 * Dragging down at the content top lowers the sheet to Closed. Kept in one file so the (still
 * experimental) AnchoredDraggable API is a single place to touch on a future Compose bump.
 */
@OptIn(ExperimentalFoundationApi::class)
@Stable
class DocumentDetailsState(val drag: AnchoredDraggableState<DetailsValue>) {

    /** Raw pane offset in px (0 at Closed, negative as it opens); 0 before anchors are set. */
    val offset: Float get() = drag.offset.takeUnless { it.isNaN() } ?: 0f

    /** 0f = closed, 1f = fully open. Drives the media lift + action-bar fade. */
    val fraction: Float
        get() {
            val open = drag.anchors.positionOf(DetailsValue.Open)
            if (open.isNaN() || open == 0f) return 0f
            return (offset / open).coerceIn(0f, 1f)
        }

    val isOpen: Boolean get() = drag.currentValue != DetailsValue.Closed

    /** True while opening OR open — gates the back handler and disables paging/viewer gestures. */
    val isOpenOrOpening: Boolean get() = drag.targetValue != DetailsValue.Closed

    suspend fun open() = drag.animateTo(DetailsValue.Open)

    suspend fun close() = drag.animateTo(DetailsValue.Closed)

    /**
     * Only chains the *downward* leftover scroll into the drag: at the content top, pulling down
     * lowers the sheet to Closed. Upward scrolling is left entirely to the content, so expanding the
     * sheet over the media is a plain, un-snapped scroll.
     */
    fun nestedScrollConnection(): NestedScrollConnection = object : NestedScrollConnection {
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
            return Offset(x = 0f, y = drag.dispatchRawDelta(available.y))
        }

        override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity {
            if (available.y <= 0f) return Velocity.Zero
            drag.settle(available.y)
            return available
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun rememberDocumentDetailsState(): DocumentDetailsState {
    val density = LocalDensity.current
    // A spring honours the fling velocity and eases into the detent, instead of the abrupt stop a
    // fixed-duration tween gives when it ignores the incoming velocity.
    val snap: AnimationSpec<Float> = spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow)
    val decay = exponentialDecay<Float>()
    val positionalThreshold = { distance: Float -> distance * 0.4f }
    val velocityThreshold = { with(density) { 125.dp.toPx() } }

    val drag = rememberSaveable(
        saver = AnchoredDraggableState.Saver(
            snapAnimationSpec = snap,
            decayAnimationSpec = decay,
            positionalThreshold = positionalThreshold,
            velocityThreshold = velocityThreshold,
        ),
    ) {
        AnchoredDraggableState(
            initialValue = DetailsValue.Closed,
            positionalThreshold = positionalThreshold,
            velocityThreshold = velocityThreshold,
            snapAnimationSpec = snap,
            decayAnimationSpec = decay,
        )
    }
    return remember(drag) { DocumentDetailsState(drag) }
}
