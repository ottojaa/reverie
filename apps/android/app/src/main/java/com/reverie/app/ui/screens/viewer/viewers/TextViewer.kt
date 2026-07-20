package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Read-only text/JSON viewer with a line-number gutter. */
@Composable
fun TextViewer(
    loadFile: suspend () -> File,
    modifier: Modifier = Modifier,
    // Disabled while the details pane is open so the text scroll doesn't steal the drag-to-close.
    scrollEnabled: Boolean = true,
) {
    var lines by remember { mutableStateOf<List<String>?>(null) }
    var failed by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching {
            val file = loadFile()
            // Bounded streaming read: stop after MAX_LINES and clamp each line to MAX_LINE_CHARS so a
            // huge file — or a minified single-line JSON (application/json routes here) — never pulls
            // its full contents into memory or hands one enormous line to the layout.
            withContext(Dispatchers.IO) {
                file.useLines { seq -> seq.take(MAX_LINES).map { it.take(MAX_LINE_CHARS) }.toList() }
            }
        }.onSuccess { lines = it }.onFailure { failed = true }
    }

    ViewerContent(value = lines, failed = failed, failureText = "Couldn't open this file", modifier = modifier) { loaded ->
        TextContent(loaded, scrollEnabled)
    }
}

/**
 * Virtualized render of [lines]: a LazyColumn (one row per line) so only visible lines compose —
 * a 5000-line CSV no longer lays out as one giant Text on the main thread. The font is monospace,
 * so the longest line's pixel width is measured once to fix the lane width; the whole lane sits in
 * a single outer [horizontalScroll] so every line shares one horizontal offset and columns stay
 * aligned (a per-row scroll would let extents fight). Selection is limited to composed rows.
 */
@Composable
private fun TextContent(lines: List<String>, scrollEnabled: Boolean) {
    val monoStyle = remember { TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp) }
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current

    // Measure the widest line exactly once. Monospace → the longest line by char count is the widest,
    // so a single measure fixes the lane width.
    val laneWidth = remember(lines, monoStyle) {
        val longest = lines.maxByOrNull { it.length } ?: ""
        val widthPx = measurer.measure(longest, monoStyle).size.width
        // A couple dp of slack so softWrap=false never clips the final glyph to sub-pixel rounding.
        with(density) { widthPx.toDp() } + LANE_SLACK
    }

    // Clear the status bar + floating toolbar so the first lines aren't hidden.
    val topInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + VIEWER_TOOLBAR_INSET
    SelectionContainer {
        Box(
            // Opaque backdrop so the dive-hero thumbnail beneath the viewer doesn't bleed through the
            // text (see DocumentPage's container transform). fillMaxSize keeps the backdrop covering
            // the whole viewport even when the text lane is narrower; one outer horizontal scroll
            // moves every line together so columns stay aligned.
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .horizontalScroll(rememberScrollState(), enabled = scrollEnabled),
        ) {
            LazyColumn(
                modifier = Modifier.width(laneWidth).fillMaxHeight(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = topInset, bottom = 12.dp),
                userScrollEnabled = scrollEnabled,
            ) {
                items(lines) { line ->
                    Text(
                        // A blank line still needs one line's height, so give it a space to lay out.
                        text = line.ifEmpty { " " },
                        fontFamily = FontFamily.Monospace,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        softWrap = false,
                    )
                }
            }
        }
    }
}

private const val MAX_LINES = 5000
private const val MAX_LINE_CHARS = 4000
private val LANE_SLACK = 4.dp
