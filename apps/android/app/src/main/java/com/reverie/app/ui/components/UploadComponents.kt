package com.reverie.app.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.data.local.entity.UploadItemEntity

/** Two-phase overall progress: uploading bytes, then generating previews. */
@Composable
fun TwoPhaseProgressBar(items: List<UploadItemEntity>, modifier: Modifier = Modifier) {
    val total = items.size.coerceAtLeast(1)
    val done = items.count { it.status == "complete" || it.status == "failed" }
    // Continuous fraction: finished files count as 100%, the in-flight file contributes its bytes,
    // so the bar advances smoothly instead of jumping a whole file at a time.
    val accumulated = items.sumOf { item ->
        if (item.status == "complete" || item.status == "failed") 100 else item.progress.coerceIn(0, 100)
    }
    val fraction by animateFloatAsState(accumulated.toFloat() / (total * 100f), animationSpec = tween(200, easing = LinearEasing), label = "upload")
    val allDone = done == items.size

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = if (allDone) "$done of ${items.size} uploaded" else "Uploading… $done of ${items.size}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        LinearProgressIndicator(
            progress = { fraction },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            color = MaterialTheme.colorScheme.primary,
        )
    }
}
