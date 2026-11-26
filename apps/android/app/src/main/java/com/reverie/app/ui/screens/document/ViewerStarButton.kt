package com.reverie.app.ui.screens.document

import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.ui.components.StarIcon

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
    IconButton(
        onClick = { onToggle(key) },
        enabled = enabled,
        modifier = modifier.size(44.dp),
    ) {
        StarIcon(
            filled = isStarred,
            contentDescription = if (isStarred) "Remove from favourites" else "Add to favourites",
            tint = if (enabled) onSurface else onSurface.copy(alpha = 0.38f),
            modifier = Modifier.size(22.dp),
        )
    }
}
