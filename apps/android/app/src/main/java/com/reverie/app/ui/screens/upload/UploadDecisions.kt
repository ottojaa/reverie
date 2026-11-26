package com.reverie.app.ui.screens.upload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.reverie.app.domain.upload.NameStrategy

/** What the check found, in words. The web upload dialog says the same; keep them in step. */
@Composable
internal fun FindingsSummary(state: ReviewState) {
    val anyContent = state.findings.any { it.hasContentMatch }
    Column(Modifier.padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            if (anyContent) "Some of these are already in your library" else "Some names are already taken",
            style = MaterialTheme.typography.titleMedium,
        )
        if (anyContent) {
            Text(
                "Skipped files are left out of this upload. You can still upload any of them.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (state.unhashed > 0) {
            val files = if (state.unhashed == 1) "file" else "files"
            Text(
                "Couldn't check the contents of ${state.unhashed} $files, comparing names only.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/** The one replace / keep both answer for every file whose name is taken. */
@Composable
internal fun StrategyChoice(selected: NameStrategy, onSelect: (NameStrategy) -> Unit) {
    Column(Modifier.padding(top = 14.dp)) {
        Text(
            "For files whose name is already taken:",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        StrategyOption("Replace the existing file (it goes to Trash)", selected == NameStrategy.REPLACE) { onSelect(NameStrategy.REPLACE) }
        StrategyOption("Keep both files", selected == NameStrategy.KEEP_BOTH) { onSelect(NameStrategy.KEEP_BOTH) }
    }
}

@Composable
private fun StrategyOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .heightIn(min = 40.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, modifier = Modifier.padding(end = 8.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
