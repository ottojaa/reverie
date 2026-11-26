package com.reverie.app.ui.screens.manage

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DriveFileMove
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.SelectionAction
import com.reverie.app.ui.components.SelectionTopBar
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.screens.favourites.FavouriteController
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.favourites.FavouriteHost
import com.reverie.app.ui.screens.favourites.ReverieSnackbarHost

/** What the selection bar offers. */
enum class PickedAction { DOWNLOAD, FAVOURITE, MOVE, TRASH, RENAME, PRIVACY }

/**
 * Selection on a screen: while something is selected [bar] takes the header's place, and Back clears the
 * selection instead of leaving.
 */
@Composable
fun SelectionOverlay(
    isSelecting: Boolean,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
    bar: @Composable () -> Unit,
) {
    BackHandler(enabled = isSelecting, onBack = onClear)
    AnimatedVisibility(
        visible = isSelecting,
        enter = slideInVertically { -it } + fadeIn(),
        exit = slideOutVertically { -it } + fadeOut(),
        modifier = modifier,
    ) { bar() }
}

/**
 * The selection of a list of documents and folders, acting through [manage]. [onDownload] is given on the
 * screens that offer downloading.
 */
@Composable
fun PickedSelection(
    picked: Picked,
    selection: Selection,
    manage: ManageController,
    modifier: Modifier = Modifier,
    onDownload: ((List<String>) -> Unit)? = null,
) {
    val favourites by manage.favouriteState.collectAsStateWithLifecycle()
    // What the bar showed stays on it while it slides away.
    var shown by remember { mutableStateOf(picked) }
    if (!picked.isEmpty) shown = picked

    SelectionOverlay(!picked.isEmpty, selection::clear, modifier) {
        PickedTopBar(
            picked = shown,
            isStarred = shown.keys.all(favourites::isStarred),
            canDownload = onDownload != null,
            onClose = selection::clear,
        ) { action ->
            when (action) {
                PickedAction.DOWNLOAD -> onDownload?.invoke(picked.documents.map { it.id })
                PickedAction.FAVOURITE -> manage.toggleFavourites(picked)
                PickedAction.RENAME -> picked.onlyFolder?.let(manage::askToRename)
                PickedAction.PRIVACY -> picked.onlyFolder?.let { manage.setPrivate(it.id, !it.is_private) }
                // These ask first, and clear what they change once it is changed.
                PickedAction.MOVE -> return@PickedTopBar manage.pickDestination(picked, selection::remove)
                PickedAction.TRASH -> return@PickedTopBar manage.askToTrash(picked, selection::remove)
            }
            selection.clear()
        }
    }
}

/**
 * A page whose list can be selected from: [content] under the selection bar, with what acting on a selection
 * needs. Messages show [bottomSpace] above the bottom edge.
 */
@Composable
fun PickingPage(
    picked: Picked,
    selection: Selection,
    manage: ManageController,
    favourites: FavouriteController,
    modifier: Modifier = Modifier,
    bottomSpace: Dp = bottomBarInset(),
    onGo: (FavouriteDestination) -> Unit = {},
    content: @Composable () -> Unit,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    Box(modifier.fillMaxSize()) {
        content()
        PickedSelection(picked, selection, manage, Modifier.align(Alignment.TopCenter))
        ReverieSnackbarHost(snackbarHostState, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomSpace))
    }
    FavouriteHost(favourites, snackbarHostState, onGo)
    ManageHost(manage, snackbarHostState)
}

/**
 * The bar for [picked]. What it offers follows what is selected: a download for documents alone, a folder's
 * own actions for one folder alone, and only the star where a locked favourite is among them.
 */
@Composable
fun PickedTopBar(
    picked: Picked,
    isStarred: Boolean,
    canDownload: Boolean,
    onClose: () -> Unit,
    onPick: (PickedAction) -> Unit,
) {
    val isOpen = picked.locked.isEmpty()
    SelectionTopBar(picked.count, onClose) {
        if (canDownload && isOpen && picked.folders.isEmpty()) {
            SelectionAction("Download", Icons.Outlined.Download) { onPick(PickedAction.DOWNLOAD) }
        }
        SelectionAction(
            if (isStarred) "Remove from favourites" else "Add to favourites",
            if (isStarred) Icons.Filled.Star else Icons.Outlined.StarOutline,
        ) { onPick(PickedAction.FAVOURITE) }
        if (!isOpen) return@SelectionTopBar
        SelectionAction("Move", Icons.AutoMirrored.Outlined.DriveFileMove) { onPick(PickedAction.MOVE) }
        SelectionAction("Move to Trash", Icons.Outlined.Delete) { onPick(PickedAction.TRASH) }
        picked.onlyFolder?.let { FolderOverflow(it, onPick) }
    }
}

/** A folder private only through one above it cannot be made private or public by itself. */
@Composable
private fun FolderOverflow(folder: FolderWithChildren, onPick: (PickedAction) -> Unit) {
    var isOpen by remember { mutableStateOf(false) }
    Box {
        SelectionAction("More folder actions", Icons.Filled.MoreVert) { isOpen = true }
        DropdownMenu(expanded = isOpen, onDismissRequest = { isOpen = false }) {
            MenuItem("Rename", Icons.Outlined.Edit) { onPick(PickedAction.RENAME) }
            if (folder.is_private || folder.lock_id == null) {
                MenuItem(
                    if (folder.is_private) "Remove from private" else "Make private",
                    if (folder.is_private) Icons.Outlined.LockOpen else Icons.Outlined.Lock,
                ) { onPick(PickedAction.PRIVACY) }
            }
        }
    }
}

@Composable
private fun MenuItem(label: String, icon: ImageVector, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null) },
        onClick = onClick,
    )
}
