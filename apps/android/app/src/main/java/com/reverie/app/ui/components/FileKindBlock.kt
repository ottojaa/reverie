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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.theme.GeistMonoFontFamily

/**
 * A file with no picture: a block tinted by its kind, the extension near the top. [compact] shrinks
 * the label for a quarter of a cover mosaic.
 */
@Composable
internal fun FileKindBlock(mimeType: String, filename: String, modifier: Modifier = Modifier, compact: Boolean = false) {
    val tint = fileTypeVisual(mimeType, filename).tint
    val base = MaterialTheme.colorScheme.surfaceContainerHighest
    Box(modifier.background(tint.copy(alpha = 0.30f).compositeOver(base)), contentAlignment = Alignment.TopCenter) {
        Text(
            text = fileTypeLabel(mimeType, filename),
            color = tint,
            fontFamily = GeistMonoFontFamily,
            fontSize = if (compact) 8.sp else 11.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.padding(top = if (compact) 3.dp else 8.dp),
        )
    }
}
