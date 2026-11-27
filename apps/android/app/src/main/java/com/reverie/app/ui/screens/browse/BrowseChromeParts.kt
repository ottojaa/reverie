package com.reverie.app.ui.screens.browse

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import com.reverie.app.ui.navigation.LocalBottomBarScrollState
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlin.math.roundToInt

/**
 * Places the body under the header, following it as it slides away: the body is as tall as the room
 * the header leaves, so a drag that is hiding the header moves the list with the finger. (The scroll
 * behaviour hands the whole drag to the header while it moves; a list with a fixed top gap would stand still.)
 */
internal fun Modifier.belowHeader(headerPx: () -> Int, heightOffset: () -> Float): Modifier = layout { measurable, constraints ->
    val top = (headerPx() + heightOffset()).roundToInt().coerceIn(0, constraints.maxHeight)
    val height = constraints.maxHeight - top
    val placeable = measurable.measure(constraints.copy(minHeight = height, maxHeight = height))
    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(0, top) }
}

/**
 * Drives the shell's bottom-bar visibility off the header's state, so both bars move in lockstep and
 * the bottom bar reappears at the top. Honored only when the setting is on.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BottomBarFollowsHeader(scrollBehavior: TopAppBarScrollBehavior) {
    val bottomBarScroll = LocalBottomBarScrollState.current
    LaunchedEffect(scrollBehavior, bottomBarScroll) {
        val bar = bottomBarScroll ?: return@LaunchedEffect
        snapshotFlow { scrollBehavior.state.collapsedFraction > 0.5f }
            .distinctUntilChanged()
            .collect { collapsed -> bar.value = !collapsed }
    }
}

/** Whether the list gives way to the lock prompt, or (with nothing to show) to the load error. */
internal fun SessionUi.replacesList(isEmpty: Boolean): Boolean = lockedFolderId != null || (error != null && isEmpty)
