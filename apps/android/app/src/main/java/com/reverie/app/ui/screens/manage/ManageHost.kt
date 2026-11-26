package com.reverie.app.ui.screens.manage

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DriveFileMove
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.ConflictStrategy
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.CreateEditFolderSheet
import com.reverie.app.ui.components.FavouriteMenuItem
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.screens.browse.UnlockSheetHost
import com.reverie.app.ui.screens.destination.DestinationPickerDialog

/** How many of the clashing names the question spells out. */
private const val NAMES_SHOWN = 3

/** What a folder's menu offers. */
enum class FolderChoice { FAVOURITE, RENAME, MOVE, PRIVACY, DELETE }

/** Everything [controller] has to ask or show: the folder menu, its dialogs, the destination browser and the password prompt. */
@Composable
fun ManageHost(controller: ManageController, snackbarHostState: SnackbarHostState) {
    val dialog by controller.dialog.collectAsStateWithLifecycle()
    LaunchedEffect(controller) { controller.notices.collect { snackbarHostState.showSnackbar(it) } }

    when (val shown = dialog) {
        null -> Unit
        is ManageDialog.Menu -> FolderMenuSheet(
            folder = shown.folder,
            isStarred = shown.isStarred,
            onPick = { controller.pick(shown.folder, it) },
            onDismiss = controller::dismiss,
        )
        is ManageDialog.Rename -> CreateEditFolderSheet(
            title = "Edit folder",
            initial = shown.folder.toForm(),
            onSubmit = { controller.rename(shown.folder.id, it) },
            onDismiss = controller::dismiss,
            allowPrivate = false,
        )
        is ManageDialog.ConfirmDelete -> ConfirmDialog(
            title = "Delete “${shown.folder.name}”?",
            message = trashMessage(shown.folder),
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = { controller.delete(shown.folder.id) },
            onDismiss = controller::dismiss,
        )
        is ManageDialog.NameClash -> NameClashDialog(
            clash = shown,
            onResolve = { controller.resolveClash(shown.move, it) },
            onDismiss = controller::dismiss,
        )
    }
    DestinationPickerDialog(controller.browser, onSelect = controller::moveTo)
    UnlockSheetHost(controller.unlocker)
}

private fun ManageController.pick(folder: FolderWithChildren, choice: FolderChoice) = when (choice) {
    FolderChoice.FAVOURITE -> toggleFavourite(folder)
    FolderChoice.RENAME -> askToRename(folder)
    FolderChoice.MOVE -> pickFolderDestination(folder)
    FolderChoice.PRIVACY -> setPrivate(folder.id, !folder.is_private)
    FolderChoice.DELETE -> askToDelete(folder)
}

private fun FolderWithChildren.toForm() = FolderFormData(name, emoji, description, is_private)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FolderMenuSheet(
    folder: FolderWithChildren,
    isStarred: Boolean,
    onPick: (FolderChoice) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        // Half open, a short screen would hide the last rows.
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        FolderMenu(folder, isStarred, onPick, Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()))
    }
}

/**
 * The menu of one folder. A folder private only through one above it cannot be made private or public by
 * itself, so it is not offered that.
 */
@Composable
fun FolderMenu(
    folder: FolderWithChildren,
    isStarred: Boolean,
    onPick: (FolderChoice) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Text(
            folder.name,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
        )
        FavouriteMenuItem(isStarred, onClick = { onPick(FolderChoice.FAVOURITE) })
        MenuItem("Rename", Icons.Outlined.Edit) { onPick(FolderChoice.RENAME) }
        MenuItem("Move", Icons.AutoMirrored.Outlined.DriveFileMove) { onPick(FolderChoice.MOVE) }
        if (folder.is_private || folder.lock_id == null) {
            MenuItem(
                if (folder.is_private) "Remove from private" else "Make private",
                if (folder.is_private) Icons.Outlined.LockOpen else Icons.Outlined.Lock,
            ) { onPick(FolderChoice.PRIVACY) }
        }
        MenuItem("Delete", Icons.Outlined.Delete) { onPick(FolderChoice.DELETE) }
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

@Composable
private fun NameClashDialog(
    clash: ManageDialog.NameClash,
    onResolve: (ConflictStrategy) -> Unit,
    onDismiss: () -> Unit,
) {
    val named = clash.taken.take(NAMES_SHOWN).joinToString("\n")
    val more = clash.taken.size - NAMES_SHOWN
    val rest = if (more > 0) "\nand $more more" else ""
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Already in ${clash.move.destination.name}") },
        text = { Text("$named$rest\n\nReplacing sends the files there now to the trash.") },
        confirmButton = {
            Row {
                TextButton(
                    onClick = { onResolve(ConflictStrategy.REPLACE) },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Replace") }
                TextButton(onClick = { onResolve(ConflictStrategy.KEEP_BOTH) }) { Text("Keep both") }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
