package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.ui.components.StarIcon
import com.reverie.app.ui.components.StarredBadge

private const val SHELF_SIZE = 8

/** Collections' shelf: the newest favourites as cards, and the way to all of them. */
@Composable
fun FavouritesShelf(
    items: List<FavouriteDto>,
    onOpen: (FavouriteDto) -> Unit,
    onSeeAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(top = 18.dp)) {
        FavouritesHeading(items.size, onSeeAll, height = 40.dp, starSize = 20.dp, textSize = 17.sp)
        LazyRow(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(items.take(SHELF_SIZE), key = { it.type.wire + it.id }) { ShelfCard(it, onOpen) }
        }
    }
}

@Composable
private fun ShelfCard(item: FavouriteDto, onOpen: (FavouriteDto) -> Unit) {
    Column(Modifier.width(128.dp).clickable { onOpen(item) }) {
        FavouritePicture(item, FavouritePictureStyle.SHELF, Modifier.size(width = 128.dp, height = 92.dp)) {
            StarredBadge(Modifier.align(Alignment.TopEnd).padding(6.dp))
        }
        Text(
            favouriteName(item),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(
            shelfSubtitle(item),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The Files dashboard's strip: every favourite as a small square tile with its name. */
@Composable
fun FavouritesStrip(
    items: List<FavouriteDto>,
    onOpen: (FavouriteDto) -> Unit,
    onSeeAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(top = 8.dp)) {
        FavouritesHeading(items.size, onSeeAll, height = 36.dp, starSize = 18.dp, textSize = 16.sp)
        LazyRow(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(items, key = { it.type.wire + it.id }) { StripTile(it, onOpen) }
        }
    }
}

@Composable
private fun StripTile(item: FavouriteDto, onOpen: (FavouriteDto) -> Unit) {
    Column(Modifier.width(76.dp).clickable { onOpen(item) }) {
        FavouritePicture(item, FavouritePictureStyle.STRIP, Modifier.size(76.dp))
        Text(
            favouriteName(item),
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )
    }
}

@Composable
private fun FavouritesHeading(count: Int, onSeeAll: () -> Unit, height: Dp, starSize: Dp, textSize: TextUnit) {
    Row(
        // A minimum, not a fixed height, so large font sizes are not clipped.
        Modifier.fillMaxWidth().heightIn(min = height).padding(start = 20.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StarIcon(filled = true, modifier = Modifier.padding(end = 8.dp).size(starSize))
        Text(
            "Favourites",
            fontSize = textSize,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        TextButton(onClick = onSeeAll, contentPadding = PaddingValues(horizontal = 8.dp), modifier = Modifier.height(height)) {
            Text("See all $count", style = MaterialTheme.typography.bodyMedium)
        }
    }
}
