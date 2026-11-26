package com.reverie.app.ui.screens.trash

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.RestoreFromTrash
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.components.ConfirmDialog

/** The menu of the item being asked about, or the confirmation before it is deleted for good. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TrashDialogHost(viewModel: TrashViewModel) {
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()
    when (val shown = dialog) {
        null -> Unit
        is TrashDialog.Menu -> ModalBottomSheet(
            onDismissRequest = viewModel::dismiss,
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ) {
            TrashMenu(
                name = shown.item.name,
                onRestore = { viewModel.restore(shown.item) },
                onPurge = { viewModel.askToPurge(shown.item) },
                modifier = Modifier.navigationBarsPadding(),
            )
        }
        is TrashDialog.ConfirmPurge -> ConfirmDialog(
            title = "Delete “${shown.item.name}” forever?",
            message = purgeMessage(shown.item),
            confirmLabel = "Delete forever",
            destructive = true,
            onConfirm = { viewModel.purge(shown.item) },
            onDismiss = viewModel::dismiss,
        )
    }
}

@Composable
private fun TrashMenu(name: String, onRestore: () -> Unit, onPurge: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Text(
            name,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
        )
        TrashMenuItem("Restore", Icons.Outlined.RestoreFromTrash, onRestore)
        TrashMenuItem("Delete forever", Icons.Outlined.DeleteForever, onPurge)
    }
}

@Composable
private fun TrashMenuItem(label: String, icon: ImageVector, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null) },
        onClick = onClick,
    )
}
