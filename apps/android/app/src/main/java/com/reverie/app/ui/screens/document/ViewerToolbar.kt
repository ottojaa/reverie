package com.reverie.app.ui.screens.document

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Brush
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.domain.model.InsightPhase
import com.reverie.app.ui.screens.viewer.InsightTitleBlock

@Composable
fun ViewerToolbar(
    document: DocumentDto?,
    phase: InsightPhase,
    detailsOpen: Boolean,
    menuOpen: Boolean,
    onBack: () -> Unit,
    onTitleClick: () -> Unit,
    onEdit: () -> Unit,
    onMenuToggle: (Boolean) -> Unit,
    onRename: () -> Unit,
    onTogglePrivate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val canEdit = document != null &&
        (document.mime_type.startsWith("image/") || document.mime_type.startsWith("video/"))

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(
                        MaterialTheme.colorScheme.background.copy(alpha = 0.92f),
                        MaterialTheme.colorScheme.background.copy(alpha = 0f),
                    ),
                ),
            ),
    ) {
        Row(
            modifier = Modifier
                .statusBarsPadding()
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Surface(
                color = Color.Transparent,
                onClick = onTitleClick,
                modifier = Modifier.weight(1f),
            ) {
                InsightTitleBlock(
                    filename = document?.original_filename ?: "",
                    phase = phase,
                    idleLabel = document?.let { fileTypeLabel(it.mime_type) } ?: "",
                    expanded = detailsOpen,
                    modifier = Modifier.padding(vertical = 6.dp, horizontal = 4.dp),
                )
            }
            // Download and Delete live in the bottom action bar now; the overflow keeps the
            // less-frequent actions.
            // Wrap the button and its menu in a Box so the menu anchors to the button,
            // not to the trailing edge of the Row.
            Box {
                IconButton(onClick = { onMenuToggle(true) }) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = "More")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { onMenuToggle(false) }) {
                    if (canEdit) {
                        DropdownMenuItem(
                            text = { Text("Edit") },
                            leadingIcon = { Icon(Icons.Outlined.Brush, contentDescription = null) },
                            onClick = onEdit,
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("Rename") },
                        leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) },
                        onClick = onRename,
                    )
                    DropdownMenuItem(
                        text = { Text(if (document?.is_private == true) "Remove from private" else "Make private") },
                        leadingIcon = {
                            Icon(
                                if (document?.is_private == true) Icons.Outlined.LockOpen else Icons.Outlined.Lock,
                                contentDescription = null,
                            )
                        },
                        onClick = onTogglePrivate,
                    )
                }
            }
        }
    }
}

@Composable
fun RenameDialog(initial: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename") },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(text.trim()) },
                enabled = text.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun fileTypeLabel(mime: String): String = when {
    mime == "application/pdf" -> "PDF document"
    mime.startsWith("image/") -> "Image"
    mime.startsWith("video/") -> "Video"
    mime.startsWith("text/") || mime == "application/json" -> "Text file"
    else -> "File"
}
