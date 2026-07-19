package com.reverie.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.util.formatBytes
import kotlin.math.roundToInt

/** Storage usage bar: used / quota, with a success-green fill that turns to warning near full. */
@Composable
fun StorageMeter(
    usedBytes: Long,
    quotaBytes: Long,
    modifier: Modifier = Modifier,
) {
    val fraction = if (quotaBytes > 0) (usedBytes.toFloat() / quotaBytes).coerceIn(0f, 1f) else 0f
    val animated by animateFloatAsState(targetValue = fraction, label = "storage-fill")
    val extended = ReverieTheme.extendedColors
    val fillColor = if (fraction > 0.9f) extended.warning else extended.success

    Column(modifier = modifier) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(4.dp)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(animated)
                    .fillMaxHeight()
                    .background(fillColor, RoundedCornerShape(4.dp)),
            )
        }
        Text(
            text = "${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} used",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

/**
 * A tonal storage card for the top of the Library — readable (proper label + full-width bar + a
 * free-space line) but scrolls away with the list rather than sticking. The full [StorageMeter]
 * lives in Settings; this is the at-a-glance version people actually see.
 */
@Composable
fun StorageSummaryCard(
    usedBytes: Long,
    quotaBytes: Long,
    modifier: Modifier = Modifier,
) {
    val fraction = if (quotaBytes > 0) (usedBytes.toFloat() / quotaBytes).coerceIn(0f, 1f) else 0f
    val animated by animateFloatAsState(targetValue = fraction, label = "storage-summary-fill")
    val extended = ReverieTheme.extendedColors
    val fillColor = if (fraction > 0.9f) extended.warning else extended.success
    val freeBytes = (quotaBytes - usedBytes).coerceAtLeast(0)

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Storage",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "${(fraction * 100).roundToInt()}%",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box(
                modifier = Modifier
                    .padding(top = 10.dp)
                    .fillMaxWidth()
                    .height(8.dp)
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(4.dp)),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(animated)
                        .fillMaxHeight()
                        .background(fillColor, RoundedCornerShape(4.dp)),
                )
            }
            Text(
                text = "${formatBytes(usedBytes)} used · ${formatBytes(freeBytes)} free of ${formatBytes(quotaBytes)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
