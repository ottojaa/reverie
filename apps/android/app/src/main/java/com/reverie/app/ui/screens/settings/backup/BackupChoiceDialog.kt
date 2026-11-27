package com.reverie.app.ui.screens.settings.backup

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Asks whether the photos and videos already on the phone are backed up too, or only what comes after.
 * [existing] is how many of them backing those up too would add.
 */
@Composable
fun BackupChoiceDialog(
    existing: Int,
    onOnlyNew: () -> Unit,
    onIncludeExisting: () -> Unit,
    onCancel: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("What should be backed up?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This covers the albums you have ticked. If you start with new ones, you can add the older ones later on this screen.")
                Button(onClick = onOnlyNew, modifier = Modifier.fillMaxWidth()) {
                    Text("Back up only new photos (recommended)", textAlign = TextAlign.Center)
                }
                // The theme's default outline and grey label vanish on a dialog and read as disabled.
                OutlinedButton(
                    onClick = onIncludeExisting,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.primary),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
                ) {
                    Text(includeExistingLabel(existing), textAlign = TextAlign.Center)
                }
            }
        },
        confirmButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
    )
}

internal fun includeExistingLabel(existing: Int): String = when (existing) {
    0 -> "Also back up the photos and videos already on this phone"
    1 -> "Also back up the 1 photo or video already on this phone"
    else -> "Also back up the $existing photos and videos already on this phone"
}
