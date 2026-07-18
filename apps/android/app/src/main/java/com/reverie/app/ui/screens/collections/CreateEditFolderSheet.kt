package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.components.SectionIcon

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

/** Create/edit a collection or folder: emoji, name, description, private toggle. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CreateEditFolderSheet(
    title: String,
    initial: FolderFormData?,
    onSubmit: (FolderFormData) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var description by remember { mutableStateOf(initial?.description ?: "") }
    var emoji by remember { mutableStateOf(initial?.emoji) }
    var isPrivate by remember { mutableStateOf(initial?.isPrivate ?: false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
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
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("Description (optional)") },
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Private", style = MaterialTheme.typography.titleSmall)
                    Text("Hidden from search; revealed only when unlocked", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = isPrivate, onCheckedChange = { isPrivate = it })
            }

            Button(
                onClick = { onSubmit(FolderFormData(name.trim(), emoji, description.trim().ifBlank { null }, isPrivate)) },
                enabled = name.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (initial == null) "Create" else "Save") }
        }
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
