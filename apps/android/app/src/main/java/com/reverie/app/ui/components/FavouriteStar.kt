package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun StarIcon(
    filled: Boolean,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    tint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Icon(
        imageVector = if (filled) Icons.Filled.Star else Icons.Outlined.StarOutline,
        contentDescription = contentDescription,
        tint = tint,
        modifier = modifier,
    )
}

/** The badge on a starred item's picture. The same in both themes: it sits on the picture. */
@Composable
fun StarredBadge(modifier: Modifier = Modifier) {
    Box(modifier.size(22.dp).background(ON_PICTURE_SCRIM, CircleShape), contentAlignment = Alignment.Center) {
        StarIcon(filled = true, contentDescription = "Favourite", tint = Color.White, modifier = Modifier.size(13.dp))
    }
}

/** A one-line name, followed by a small star when the item is starred. */
@Composable
fun NameWithStar(
    name: String,
    isStarred: Boolean,
    modifier: Modifier = Modifier,
    style: TextStyle = TextStyle.Default,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(name, style = LocalTextStyle.current.merge(style), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (isStarred) StarIcon(filled = true, contentDescription = "Favourite", modifier = Modifier.size(14.dp))
    }
}
