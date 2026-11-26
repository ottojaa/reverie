package com.reverie.app.ui.screens.upload

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.domain.upload.UploadProgress
import com.reverie.app.ui.components.AnimatedSuccessCheck
import com.reverie.app.ui.components.TwoPhaseProgressBar
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.delay

private const val SUCCESS_SHOWN_MS = 2_000L

/** The uploads' progress, along the bottom of the screen they were started from. */
@Composable
fun UploadProgressBar(viewModel: UploadViewModel, modifier: Modifier = Modifier) {
    val progress by viewModel.progress.collectAsStateWithLifecycle()
    UploadProgressCard(progress ?: return, onDone = viewModel::clearFinished, modifier = modifier)
}

/** Success says so and clears itself away; a failure stays until dismissed. */
@Composable
fun UploadProgressCard(progress: UploadProgress, onDone: () -> Unit, modifier: Modifier = Modifier) {
    val succeeded = progress is UploadProgress.Finished && progress.failed == 0
    LaunchedEffect(succeeded) {
        if (!succeeded) return@LaunchedEffect
        delay(SUCCESS_SHOWN_MS)
        onDone()
    }

    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shadowElevation = 4.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Box(Modifier.heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 10.dp), contentAlignment = Alignment.CenterStart) {
            when (progress) {
                is UploadProgress.Running -> TwoPhaseProgressBar(progress.items)
                is UploadProgress.Finished -> UploadOutcome(progress, onDone)
            }
        }
    }
}

@Composable
private fun UploadOutcome(finished: UploadProgress.Finished, onDismiss: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (finished.failed == 0) {
            AnimatedSuccessCheck(color = ReverieTheme.extendedColors.success)
            Text("${toFileCount(finished.uploaded)} uploaded", style = MaterialTheme.typography.bodyLarge)
            return@Row
        }
        Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error)
        Text(
            "${toFileCount(finished.failed)} couldn't be uploaded",
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onDismiss) { Text("Dismiss") }
    }
}

private fun toFileCount(count: Int): String = if (count == 1) "1 file" else "$count files"
