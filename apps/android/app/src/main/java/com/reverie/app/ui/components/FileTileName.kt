package com.reverie.app.ui.components

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

private const val NAME_LINES = 2

/** A dot with letters or digits after it, at the end of a name that has something before the dot. */
private val EXTENSION = Regex("""(?<=.)\.[A-Za-z0-9]{1,12}$""")

/**
 * The name under a file tile's type: at most two lines, never with the extension broken or cut off (see
 * [fitFileName]). It is read out whole however much of it is drawn.
 */
@Composable
internal fun FileTileName(name: String, color: Color, modifier: Modifier = Modifier) {
    val style = MaterialTheme.typography.bodySmall.copy(textAlign = TextAlign.Center)
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(modifier.padding(start = 8.dp, top = 6.dp, end = 8.dp), contentAlignment = Alignment.TopCenter) {
        val width = constraints.maxWidth
        val shown = remember(name, width, style, measurer) {
            fitFileName(name) { text, extension -> measurer.holds(text, extension, style, width) }
        }
        Text(
            shown,
            style = style,
            color = color,
            maxLines = NAME_LINES,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clearAndSetSemantics { text = AnnotatedString(name) },
        )
    }
}

/** Whether [text], wrapped at [width], takes two lines at most and has its closing [extension] on one of them. */
private fun TextMeasurer.holds(text: String, extension: String, style: TextStyle, width: Int): Boolean {
    val layout = measure(text, style, constraints = Constraints(maxWidth = width))
    if (layout.lineCount > NAME_LINES) return false
    return layout.getLineForOffset(text.length - extension.length) == layout.getLineForOffset(text.length - 1)
}

/**
 * [name] as a tile shows it. The whole name where [fits], on a line of its own for the extension if need be;
 * else with the end of what comes before the extension given up for an ellipsis, so that "holiday-originals.zip"
 * becomes "holiday-orig….zip". A name without an extension is left to be cut at its end. [fits] says whether a
 * text has room with that extension unbroken.
 */
internal fun fitFileName(name: String, fits: (text: String, extension: String) -> Boolean): String {
    val extension = EXTENSION.find(name)?.value ?: return name
    val stem = name.dropLast(extension.length)
    fun laidOut(start: String): String? = listOf(start + extension, "$start\n$extension").firstOrNull { fits(it, extension) }
    laidOut(stem)?.let { return it }
    // The longest beginning of the stem that has room, found by halving. Only one seen to fit is ever kept.
    var best = "…$extension"
    var low = 1
    var high = stem.length - 1
    while (low <= high) {
        val length = (low + high) / 2
        val start = stem.take(length).dropLastWhile { it.isHighSurrogate() }.trimEnd()
        val candidate = laidOut("$start…")
        if (candidate == null) {
            high = length - 1
        } else {
            best = candidate
            low = length + 1
        }
    }
    return best
}
