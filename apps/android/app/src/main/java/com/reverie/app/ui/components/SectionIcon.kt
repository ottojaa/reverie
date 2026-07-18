package com.reverie.app.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A folder's emoji, or a fallback folder glyph. */
@Composable
fun SectionIcon(emoji: String?, modifier: Modifier = Modifier, size: Dp = 22.dp) {
    if (!emoji.isNullOrBlank()) {
        Text(text = emoji, fontSize = (size.value * 0.85f).sp, modifier = modifier)
    } else {
        Icon(
            imageVector = Icons.Outlined.Folder,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.size(size),
        )
    }
}
