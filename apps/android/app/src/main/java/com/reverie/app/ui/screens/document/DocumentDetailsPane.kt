package com.reverie.app.ui.screens.document

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * The details drawer. It's a full-height, single scroll: a transparent [headerHeight] region at the
 * top (the media shows through it), then a rounded opaque surface holding the drag handle and
 * content. Scrolling up flows the content over the media to use the whole screen — no separate
 * "expanded" detent, so it scrolls smoothly instead of snapping. Pulling down at the content top (or
 * dragging the handle / media) lowers it closed. Content is composed only once the drawer is at
 * least partially revealed, so a lite-mode map isn't initialised while it's off-screen.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DocumentDetailsPane(
    state: DocumentDetailsState,
    headerHeight: Dp,
    contentMinHeight: Dp,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()
    // Reopening should start at the peek, not wherever it was scrolled to before it closed.
    LaunchedEffect(state.isOpen) { if (!state.isOpen) scrollState.scrollTo(0) }

    Column(
        modifier
            .fillMaxWidth()
            .nestedScroll(state.nestedScrollConnection())
            .verticalScroll(scrollState),
    ) {
        // Transparent window onto the media above; scrolling flows the surface up over it, and
        // tapping it dismisses the drawer (tap the photo to go back to it).
        Spacer(
            Modifier
                .fillMaxWidth()
                .height(headerHeight)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = { scope.launch { state.close() } },
                ),
        )

        Surface(
            modifier = Modifier.fillMaxWidth().heightIn(min = contentMinHeight),
            shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
        ) {
            Column(Modifier.navigationBarsPadding()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .anchoredDraggable(state.drag, Orientation.Vertical)
                        .padding(vertical = 10.dp)
                        .semantics { contentDescription = "Drag to close details" },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .width(32.dp)
                            .height(4.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)),
                    )
                }

                if (state.isOpenOrOpening || state.fraction > 0f) {
                    content()
                }
            }
        }
    }
}
