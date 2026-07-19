package com.reverie.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.util.formatBytes

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
 * A minimal one-line storage glance (thin bar + "used of quota") for the top of a header. The
 * full [StorageMeter] lives in Settings; this is deliberately understated.
 */
@Composable
fun StorageSummary(
    usedBytes: Long,
    quotaBytes: Long,
    modifier: Modifier = Modifier,
) {
    val fraction = if (quotaBytes > 0) (usedBytes.toFloat() / quotaBytes).coerceIn(0f, 1f) else 0f
    val extended = ReverieTheme.extendedColors
    val fillColor = if (fraction > 0.9f) extended.warning else extended.success

    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .width(44.dp)
                .height(4.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(2.dp)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .background(fillColor, RoundedCornerShape(2.dp)),
            )
        }
        Text(
            text = "${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}
