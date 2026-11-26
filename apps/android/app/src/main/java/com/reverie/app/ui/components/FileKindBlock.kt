package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/** A file with no picture: its extension on a neutral block. [compact] shrinks the label for a quarter of a cover mosaic. */
@Composable
internal fun FileKindBlock(mimeType: String, filename: String, modifier: Modifier = Modifier, compact: Boolean = false) {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
        Text(
            text = fileTypeLabel(mimeType, filename),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = if (compact) 8.sp else 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.05.em,
            maxLines = 1,
            softWrap = false,
        )
    }
}
