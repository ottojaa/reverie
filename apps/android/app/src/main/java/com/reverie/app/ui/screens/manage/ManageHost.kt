package com.reverie.app.ui.screens.manage

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.ConflictStrategy
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.CreateEditFolderSheet
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.components.UnlockSheetHost
import com.reverie.app.ui.screens.destination.DestinationPickerDialog

/** How many of the clashing names the question spells out. */
private const val NAMES_SHOWN = 3

/** Everything [controller] has to ask or show: its dialogs, the destination browser and the unlock prompt. */
@Composable
fun ManageHost(controller: ManageController, snackbarHostState: SnackbarHostState) {
    val dialog by controller.dialog.collectAsStateWithLifecycle()
    LaunchedEffect(controller) { controller.notices.collect { snackbarHostState.showSnackbar(it) } }

    when (val shown = dialog) {
        null -> Unit
        is ManageDialog.Rename -> CreateEditFolderSheet(
            title = "Edit folder",
            initial = shown.folder.toForm(),
            onSubmit = { controller.rename(shown.folder.id, it) },
            onDismiss = controller::dismiss,
            allowPrivate = false,
        )
        is ManageDialog.ConfirmTrash -> TrashConfirmDialog(
            picked = shown.picked,
            onConfirm = { controller.trash(shown) },
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

/** The one confirmation every delete outside Trash shows. */
@Composable
fun TrashConfirmDialog(picked: Picked, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val question = trashQuestion(picked)
    ConfirmDialog(
        title = question.title,
        message = question.message,
        confirmLabel = "Move to Trash",
        destructive = true,
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    )
}

private fun FolderWithChildren.toForm() = FolderFormData(name, emoji, description, is_private)

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
        text = { Text("$named$rest\n\nReplacing sends the files there now to Trash.") },
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
