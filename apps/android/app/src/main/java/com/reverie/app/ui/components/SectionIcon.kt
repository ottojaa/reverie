package com.reverie.app.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * A folder/collection icon. The `emoji` field actually stores a **Lucide icon name** — the web
 * renders it via lucide's `DynamicIcon` (`SectionIcon.tsx`), e.g. "folder", "file-text",
 * "transgender". We resolve that to the bundled `lucide_ic_<snake_case>` vector drawable so the
 * glyph matches the web. Legacy values that are an actual emoji character are drawn as text, and
 * anything that doesn't resolve falls back to the folder glyph — mirroring the web's fallback order.
 */
@Composable
fun SectionIcon(emoji: String?, modifier: Modifier = Modifier, size: Dp = 22.dp) {
    val value = emoji?.trim().orEmpty()
    // A Lucide name is empty-or-ASCII kebab/lowercase; an emoji character is not.
    val looksLikeName = value.all { it == '-' || it in 'a'..'z' || it in '0'..'9' }

    if (value.isNotEmpty() && !looksLikeName) {
        Text(text = value, fontSize = (size.value * 0.85f).sp, modifier = modifier)
        return
    }

    val context = LocalContext.current
    val name = value.ifEmpty { "folder" }
    val resId = remember(name) {
        val id = context.resources.getIdentifier("lucide_ic_" + name.replace('-', '_'), "drawable", context.packageName)
        if (id != 0) id else context.resources.getIdentifier("lucide_ic_folder", "drawable", context.packageName)
    }
    Icon(
        painter = painterResource(id = resId),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.size(size),
    )
}
