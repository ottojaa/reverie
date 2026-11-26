package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class FolderFormData(
    val name: String,
    val emoji: String?,
    val description: String?,
    val isPrivate: Boolean,
)

// Lucide icon names — the same catalog the web writes into `emoji`, so a folder created here shows
// the same glyph on web. Rendered via [SectionIcon], which resolves them to lucide_ic_* drawables.
private val CURATED_ICONS = listOf(
    "folder", "folder-open", "file-text", "image", "wallet", "receipt", "credit-card",
    "briefcase", "graduation-cap", "house", "building", "plane", "car", "map-pin",
    "camera", "film", "music", "book", "heart", "heart-pulse", "stethoscope",
    "utensils", "coffee", "gift", "shopping-cart", "calendar", "star", "palette",
    "leaf", "sun", "paw-print", "dumbbell", "code", "shield",
)

/** The characters a folder name cannot hold: it is one segment of the folder's path. */
private val PATH_SEPARATORS = charArrayOf('/', '\\', '\u0000')

/** Whether the server takes [name] as a folder name: 1 to 255 characters, trimmed, no path separator. */
fun isValidFolderName(name: String): Boolean =
    name.trim().length in 1..255 && name.none { it in PATH_SEPARATORS }

/** Create or edit a folder: icon, name, description and, with [allowPrivate], the private switch. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CreateEditFolderSheet(
    title: String,
    initial: FolderFormData?,
    onSubmit: (FolderFormData) -> Unit,
    onDismiss: () -> Unit,
    allowPrivate: Boolean = true,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var description by remember { mutableStateOf(initial?.description ?: "") }
    var emoji by remember { mutableStateOf(initial?.emoji) }
    var isPrivate by remember { mutableStateOf(initial?.isPrivate ?: false) }
    val submit = {
        if (isValidFolderName(name)) onSubmit(FolderFormData(name.trim(), emoji, description.trim().ifBlank { null }, isPrivate))
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                // Lift above the keyboard and scroll the content, so focusing the Name/Description
                // field scrolls it into view instead of shoving the icon grid off the top.
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium)

            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                IconChoice(name = null, selected = emoji == null, onClick = { emoji = null })
                CURATED_ICONS.forEach { choice ->
                    IconChoice(name = choice, selected = emoji == choice, onClick = { emoji = choice })
                }
            }

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name") },
                singleLine = true,
                isError = name.any { it in PATH_SEPARATORS },
                supportingText = if (name.any { it in PATH_SEPARATORS }) {
                    { Text("A name can't contain / or \\") }
                } else {
                    null
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("Description (optional)") },
                modifier = Modifier.fillMaxWidth(),
            )
            if (allowPrivate) PrivateSwitch(isPrivate, onChange = { isPrivate = it })

            Button(
                onClick = submit,
                enabled = isValidFolderName(name),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (initial == null) "Create" else "Save") }
        }
    }
}

@Composable
private fun PrivateSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Private", style = MaterialTheme.typography.titleSmall)
            Text("Hidden from search; revealed only when unlocked", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun IconChoice(name: String?, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .background(
                color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest,
                shape = CircleShape,
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (name == null) {
            Text(
                text = "—",
                fontSize = 16.sp,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            SectionIcon(emoji = name, size = 20.dp)
        }
    }
}
