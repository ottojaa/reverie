package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import androidx.compose.ui.unit.sp
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.util.formatBytes


/** How much of the account's storage is used, over a bar that turns to warning near full. */
@Composable
fun StorageMeter(
    usedBytes: Long,
    quotaBytes: Long,
    modifier: Modifier = Modifier,
) {
    val fraction = if (quotaBytes > 0) (usedBytes.toFloat() / quotaBytes).coerceIn(0f, 1f) else 0f
    val fill = if (fraction > 0.9f) ReverieTheme.extendedColors.warning else MaterialTheme.colorScheme.primary

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Storage", fontSize = 13.sp)
            Text(
                "${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)}",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        BoxWithConstraints(
            Modifier.fillMaxWidth().height(6.dp).background(MaterialTheme.colorScheme.surfaceContainerHighest, MaterialTheme.shapes.extraSmall),
        ) {
            if (usedBytes <= 0) return@BoxWithConstraints
            // Wide enough to be seen however little is used.
            Box(Modifier.width(max(maxWidth * fraction, 8.dp)).fillMaxHeight().background(fill, MaterialTheme.shapes.extraSmall))
        }
    }
}
