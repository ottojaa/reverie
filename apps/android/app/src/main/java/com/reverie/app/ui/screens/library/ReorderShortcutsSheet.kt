package com.reverie.app.ui.screens.library

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DragHandle
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.launch

/** The rows of the sheet while they are being moved: their order, and the one being dragged. */
@Stable
internal class ReorderState(ids: List<String>) {
    var order by mutableStateOf(ids)
        private set
    var dragged by mutableStateOf<String?>(null)
        private set

    /** How far, in pixels, the dragged row is from the place it holds in [order]. */
    var offset by mutableFloatStateOf(0f)
        private set

    /** Moves [id]'s row [by] pixels; it takes a neighbour's place once it is more than half way there. */
    fun drag(id: String, by: Float, rowHeight: Int) {
        if (dragged != id) {
            dragged = id
            offset = 0f
        }
        offset += by
        while (offset > rowHeight / 2f && move(id, 1)) offset -= rowHeight
        while (offset < -rowHeight / 2f && move(id, -1)) offset += rowHeight
    }

    fun drop() {
        dragged = null
        offset = 0f
    }

    /** Moves [id] [by] places, and says whether there was a place that far to move it to. */
    fun move(id: String, by: Int): Boolean {
        val from = order.indexOf(id)
        val to = from + by
        if (from < 0 || to !in order.indices) return false
        order = order.toMutableList().apply { add(to, removeAt(from)) }
        return true
    }
}

/**
 * The sheet that puts the shortcut chips in another order.
 *
 * @param onReorder the chips of [shortcuts] in their new order, after every drag and every move.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReorderShortcutsSheet(
    shortcuts: List<Shortcut>,
    onReorder: (List<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        ReorderShortcuts(shortcuts, onReorder, onDone = {
            scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
        })
    }
}

/** How far the lifted row's background reaches past the text, on each side. */
private val ROW_BLEED = 10.dp

/** The space between the sheet's edge and what it holds. */
private val SHEET_MARGIN = 20.dp

/** What the sheet holds: its title, Done, and a row with a drag handle for each chip. */
@Composable
internal fun ReorderShortcuts(
    shortcuts: List<Shortcut>,
    onReorder: (List<String>) -> Unit,
    onDone: () -> Unit,
    // Made anew only for other chips: their order coming back from the settings must not end a drag.
    state: ReorderState = remember(shortcuts.map { it.id }.toSet()) { ReorderState(shortcuts.map { it.id }) },
) {
    val byId = shortcuts.associateBy { it.id }
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(start = SHEET_MARGIN - ROW_BLEED, end = SHEET_MARGIN - ROW_BLEED, bottom = 16.dp),
    ) {
        ReorderTitle(onDone, Modifier.padding(horizontal = ROW_BLEED))
        Text(
            "Hold a handle and drag.",
            fontSize = 13.sp,
            lineHeight = 18.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = ROW_BLEED, end = ROW_BLEED, top = 4.dp, bottom = 10.dp),
        )
        state.order.forEach { id ->
            val shortcut = byId[id] ?: return@forEach
            // Keyed, so a row keeps the finger and the screen reader's focus as it changes places.
            key(id) { ReorderRow(shortcut, state, onReorder) }
        }
    }
}

/** The title with Done at its end; where large text leaves no room beside the title, Done goes under it. */
@Composable
private fun ReorderTitle(onDone: () -> Unit, modifier: Modifier) {
    FlowRow(
        modifier = modifier.fillMaxWidth().heightIn(min = 44.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Reorder shortcuts",
            fontSize = 20.sp,
            lineHeight = 26.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(end = 12.dp).semantics { heading() },
        )
        Button(onClick = onDone) { Text("Done", fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun ReorderRow(shortcut: Shortcut, state: ReorderState, onReorder: (List<String>) -> Unit) {
    var height by remember { mutableIntStateOf(0) }
    val lifted = state.dragged == shortcut.id
    val shape = RoundedCornerShape(14.dp)
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .zIndex(if (lifted) 1f else 0f)
            .graphicsLayer { translationY = if (lifted) state.offset else 0f }
            .fillMaxWidth()
            .onSizeChanged { height = it.height }
            .shadow(if (lifted) 8.dp else 0.dp, shape)
            .background(if (lifted) MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent, shape)
            .heightIn(min = 56.dp)
            .padding(horizontal = ROW_BLEED),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            shortcut.label,
            fontSize = 16.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (shortcut.count != null) {
            Text(shortcut.count.toString(), fontSize = 14.sp, color = quiet, modifier = Modifier.padding(start = 14.dp))
        }
        DragHandle(shortcut, state, rowHeight = { height }, onReorder)
    }
}

/** Dragging it moves its row; a screen reader or switch moves the row with the handle's own actions. */
@Composable
private fun DragHandle(shortcut: Shortcut, state: ReorderState, rowHeight: () -> Int, onReorder: (List<String>) -> Unit) {
    val id = shortcut.id
    fun action(label: String, by: Int) = CustomAccessibilityAction(label) {
        state.move(id, by).also { if (it) onReorder(state.order) }
    }
    val actions = listOfNotNull(
        action("Move up", -1).takeIf { state.order.firstOrNull() != id },
        action("Move down", 1).takeIf { state.order.lastOrNull() != id },
    )
    val drag = rememberDraggableState { state.drag(id, it, rowHeight()) }
    Box(
        modifier = Modifier
            .padding(start = 6.dp)
            .size(48.dp)
            // Takes the finger as it lands, so neither the sheet nor its scrolling moves instead.
            .draggable(
                state = drag,
                orientation = Orientation.Vertical,
                startDragImmediately = true,
                onDragStopped = {
                    state.drop()
                    onReorder(state.order)
                },
            )
            .semantics {
                contentDescription = "Move ${shortcut.label}"
                customActions = actions
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Rounded.DragHandle, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
