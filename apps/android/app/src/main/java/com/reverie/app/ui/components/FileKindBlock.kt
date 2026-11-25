package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.theme.GeistMonoFontFamily

/**
 * A file with no picture: a block tinted by its kind, the extension near the top. [compact] shrinks
 * the label for a quarter of a cover mosaic.
 */
@Composable
internal fun FileKindBlock(
    mimeType: String,
    filename: String,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    labelAlignment: Alignment = Alignment.TopCenter,
    labelSize: TextUnit = if (compact) 8.sp else 11.sp,
) {
    val tint = fileTypeVisual(mimeType, filename).tint
    val base = MaterialTheme.colorScheme.surfaceContainerHighest
    Box(modifier.background(tint.copy(alpha = 0.30f).compositeOver(base)), contentAlignment = labelAlignment) {
        Text(
            text = fileTypeLabel(mimeType, filename),
            color = tint,
            fontFamily = GeistMonoFontFamily,
            fontSize = labelSize,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.padding(
                start = if (labelAlignment == Alignment.TopStart) 7.dp else 0.dp,
                top = if (compact) 3.dp else 8.dp,
            ),
        )
    }
}
