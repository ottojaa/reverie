package com.reverie.app.ui.screens.document

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.ui.components.StarIcon
import com.reverie.app.ui.components.starColor

/**
 * The viewer's one-tap star for the document on screen. Disabled until the favourites are known, so
 * a tap never acts on a guess.
 */
@Composable
fun ViewerStarButton(
    favourites: FavouritesState,
    documentId: String,
    onToggle: (FavouriteKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val key = FavouriteKey(FavouriteType.DOCUMENT, documentId)
    val enabled = favourites.isLoaded
    val isStarred = favourites.isStarred(key)
    val onSurface = MaterialTheme.colorScheme.onSurface
    val tint = when {
        !enabled -> onSurface.copy(alpha = 0.38f)
        isStarred -> starColor()
        else -> onSurface
    }
    IconButton(
        onClick = { onToggle(key) },
        enabled = enabled,
        modifier = modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(if (isStarred) Color(0x26FBBF24) else Color.Transparent),
    ) {
        StarIcon(
            filled = isStarred,
            contentDescription = if (isStarred) "Remove from favourites" else "Add to favourites",
            tint = tint,
            modifier = Modifier.size(22.dp),
        )
    }
}
