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
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

private val STAR_ON_DARK = Color(0xFFFBBF24)
private val STAR_ON_LIGHT = Color(0xFFD97706) // deeper, to keep its contrast on a light surface
private val BADGE_SCRIM = Color(0xC7121212)

/** The favourite star's amber for the theme that is showing. */
@Composable
fun starColor(): Color =
    if (MaterialTheme.colorScheme.background.luminance() < 0.5f) STAR_ON_DARK else STAR_ON_LIGHT

@Composable
fun StarIcon(
    filled: Boolean,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    tint: Color = starColor(),
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
    Box(modifier.size(22.dp).background(BADGE_SCRIM, CircleShape), contentAlignment = Alignment.Center) {
        StarIcon(filled = true, contentDescription = "Favourite", tint = STAR_ON_DARK, modifier = Modifier.size(13.dp))
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

/** The menu item that stars an item, or unstars a starred one. */
@Composable
fun FavouriteMenuItem(isStarred: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(if (isStarred) "Remove from favourites" else "Add to favourites") },
        leadingIcon = { StarIcon(filled = isStarred) },
        onClick = onClick,
    )
}
