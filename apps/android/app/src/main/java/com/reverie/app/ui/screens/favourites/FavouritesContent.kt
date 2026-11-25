package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.ui.components.ChoiceChip
import com.reverie.app.ui.components.ReverieRefreshBox
import com.reverie.app.ui.components.StarIcon
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.theme.ReverieTheme

/** The Favourites screen's three chips. */
enum class FavouriteFilter(val label: String, val emptyNote: String) {
    ALL("All", "Nothing starred yet. Star a file or folder to find it here."),
    FOLDERS("Folders", "No starred folders."),
    FILES("Files", "No starred files.");

    fun matches(item: FavouriteDto): Boolean = this == ALL || item.isFolder() == (this == FOLDERS)
}

/** What the Favourites screen can ask for, so the stateless content takes one parameter. */
class FavouritesActions(
    val onBack: () -> Unit = {},
    val onFilter: (FavouriteFilter) -> Unit = {},
    val onOpen: (FavouriteDto) -> Unit = {},
    val onUnstar: (FavouriteDto) -> Unit = {},
    val onRefresh: () -> Unit = {},
)

/** The Favourites screen without its state holder: header, filter chips and a two-column grid. */
@Composable
fun FavouritesContent(
    state: FavouritesState,
    filter: FavouriteFilter,
    actions: FavouritesActions,
    modifier: Modifier = Modifier,
    isFetching: Boolean = false,
    isPulling: Boolean = false,
) {
    val shown = state.visible.filter(filter::matches)
    ReverieRefreshBox(isRefreshing = isPulling, onRefresh = actions.onRefresh, modifier = modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
            Header(state, actions.onBack)
            FilterChips(filter, actions.onFilter)
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.weight(1f),
                // Room for the bottom navigation that overlays the grid.
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = bottomBarInset() + 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                // A full-width item rather than a separate layout, so the empty screen can still be pulled.
                if (shown.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Placeholder(state, filter, isFetching) }
                items(shown, key = { it.type.wire + it.id }) { FavouriteCard(it, actions, Modifier.animateItem()) }
            }
        }
    }
}

@Composable
private fun Header(state: FavouritesState, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
        Column(Modifier.weight(1f)) {
            Text("Favourites", fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold)
            if (state.isLoaded) {
                Text(countLine(state.visible), fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

internal fun countLine(items: List<FavouriteDto>): String {
    val folders = items.count { it.isFolder() }
    val files = items.size - folders
    return counted(folders, "folder") + " · " + counted(files, "file")
}

private fun counted(count: Int, noun: String): String = if (count == 1) "1 $noun" else "$count ${noun}s"

@Composable
private fun FilterChips(selected: FavouriteFilter, onFilter: (FavouriteFilter) -> Unit) {
    Row(
        Modifier.padding(horizontal = 20.dp, vertical = 16.dp).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FavouriteFilter.entries.forEach { filter ->
            ChoiceChip(filter.label, isSelected = filter == selected, onClick = { onFilter(filter) })
        }
    }
}

@Composable
private fun FavouriteCard(item: FavouriteDto, actions: FavouritesActions, modifier: Modifier = Modifier) {
    Column(modifier.clickable { actions.onOpen(item) }) {
        FavouritePicture(item, FavouritePictureStyle.GRID, Modifier.fillMaxWidth().height(112.dp)) {
            IconButton(onClick = { actions.onUnstar(item) }, modifier = Modifier.align(Alignment.TopEnd).size(44.dp)) {
                // The scrim keeps the star legible on a bright photo.
                Box(Modifier.size(30.dp).background(Color(0x66121212), CircleShape), contentAlignment = Alignment.Center) {
                    StarIcon(
                        filled = true,
                        contentDescription = "Remove from favourites",
                        tint = ReverieTheme.extendedColors.starOnScrim,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
        Text(
            favouriteName(item),
            fontSize = 15.sp,
            lineHeight = 20.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(
            gridSubtitle(item),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** What stands in for the grid: a spinner on the first fetch, else why there is nothing to show. */
@Composable
private fun Placeholder(state: FavouritesState, filter: FavouriteFilter, isFetching: Boolean) {
    Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
        if (!state.isLoaded && isFetching) {
            CircularProgressIndicator()
            return@Box
        }
        Text(
            if (state.isLoaded) filter.emptyNote else "Couldn't load favourites. Pull down to try again.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
